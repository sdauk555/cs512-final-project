const SURFACE = `
uniform highp usampler2D streetLayout;
uniform vec2 streetOrigin;

const float GROUND_Y = -0.75;
const float CURB_Y = GROUND_Y + 0.09;
const float STREET_CELL = ${STREET.CELL_SIZE.toFixed(2)};
const float STREET_TILE = ${STREET.TILE_SIZE.toFixed(2)};
const uint GRASS = ${STREET.MATERIAL.grass}u;
const uint CONCRETE = ${STREET.MATERIAL.concrete}u;
const uint STRIPE_X = ${STREET.MATERIAL.stripeX}u;
const uint STRIPE_Z = ${STREET.MATERIAL.stripeZ}u;

bool inStreetGrid(ivec2 cell, ivec2 size) {
    return all(greaterThanEqual(cell, ivec2(0))) && all(lessThan(cell, size));
}

uint streetMaterial(vec2 point) {
    ivec2 cell = ivec2(floor((point - streetOrigin) / STREET_CELL));
    if (!inStreetGrid(cell, textureSize(streetLayout, 0))) return GRASS;
    return texelFetch(streetLayout, cell, 0).r;
}

bool intersectSidewalk(Ray ray, float limit, out float t, out vec3 normal) {
    ivec2 size = textureSize(streetLayout, 0);
    vec2 farEdge = streetOrigin + vec2(size) * STREET_CELL;
    vec3 lower = vec3(streetOrigin.x, GROUND_Y, streetOrigin.y);
    vec3 upper = vec3(farEdge.x, CURB_Y, farEdge.y);
    float enter = 0.001;
    float leave = limit;
    normal = vec3(0.0, 1.0, 0.0);
    for (int axis = 0; axis < 3; axis++) {
        float direction = ray.direction[axis];
        float origin = ray.origin[axis];
        if (abs(direction) < 1e-6) {
            if (origin < lower[axis] || origin >= upper[axis]) return false;
            continue;
        }
        float a = (lower[axis] - origin) / direction;
        float b = (upper[axis] - origin) / direction;
        float near = min(a, b);
        if (near > enter) {
            enter = near;
            normal = vec3(0.0);
            normal[axis] = -sign(direction);
        }
        leave = min(leave, max(a, b));
    }
    if (enter >= leave) return false;

    vec2 direction = ray.direction.xz;
    vec2 origin = ray.origin.xz - streetOrigin;
    vec2 start = (origin + direction * (enter + min(0.00001, (leave - enter) * 0.5))) / STREET_CELL;
    ivec2 cell = clamp(ivec2(floor(start)), ivec2(0), size - 1);
    ivec2 stepTo = ivec2(sign(direction));
    vec2 next = vec2(1e10);
    vec2 delta = vec2(1e10);
    for (int axis = 0; axis < 2; axis++) {
        if (abs(direction[axis]) < 1e-6) continue;
        float boundary = float(cell[axis] + max(stepTo[axis], 0)) * STREET_CELL;
        next[axis] = (boundary - origin[axis]) / direction[axis];
        delta[axis] = STREET_CELL / abs(direction[axis]);
    }

    t = enter;
    for (int i = 0; i < size.x + size.y; i++) {
        if (texelFetch(streetLayout, cell, 0).r == CONCRETE) return true;

        t = min(next.x, next.y);
        if (t >= leave) break;
        normal = vec3(0.0);
        if (next.x == t) {
            cell.x += stepTo.x;
            next.x += delta.x;
            normal.x = -float(stepTo.x);
        }
        if (next.y == t) {
            cell.y += stepTo.y;
            next.y += delta.y;
            normal.z = -float(stepTo.y);
        }
        if (!inStreetGrid(cell, size)) break;
        normal = normalize(normal);
    }
    return false;
}

float surfaceHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

float surfaceNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(surfaceHash(cell), surfaceHash(cell + vec2(1, 0)), f.x),
               mix(surfaceHash(cell + vec2(0, 1)), surfaceHash(cell + vec2(1, 1)), f.x), f.y);
}

vec3 surfaceColor(uint material, vec3 point, vec3 normal, float distanceToHit) {
    vec2 p = point.xz;
    float detail = 1.0 - smoothstep(6.0, 30.0, distanceToHit);
    float grain = (surfaceNoise(p * 36.0) - 0.5) * detail;
    if (material == GRASS) {
        float patches = 0.65 * surfaceNoise(p * 0.7) + 0.35 * surfaceNoise(p * 4.0);
        return mix(vec3(0.11, 0.23, 0.055), vec3(0.38, 0.48, 0.14), patches) + grain * 0.12;
    }
    if (material == CONCRETE) {
        vec2 slab = (p - streetOrigin) / STREET_CELL;
        vec2 edge = abs(fract(slab - 0.5) - 0.5);
        float joint = 1.0 - smoothstep(0.008, 0.035, min(edge.x, edge.y));
        vec3 color = vec3(0.69, 0.67, 0.61) + grain * 0.08;
        return color * (normal.y > 0.5 ? 1.0 - 0.32 * joint * detail : 0.75);
    }

    vec3 asphalt = vec3(0.19, 0.20, 0.22) + grain * 0.085;
    if (material == STRIPE_X || material == STRIPE_Z) {
        vec2 lane = p - streetOrigin;
        if (material == STRIPE_Z) lane = lane.yx;
        float center = abs(fract(lane.y / STREET_CELL) - 0.5) * STREET_CELL;
        float dash = abs(fract(lane.x / (STREET_TILE * 0.5)) - 0.5);
        float paint = (1.0 - smoothstep(0.018, 0.035, center)) * (1.0 - smoothstep(0.22, 0.27, dash));
        return mix(asphalt, vec3(0.94, 0.77, 0.34), paint);
    }
    return asphalt;
}

void intersectSurface(Ray ray, inout HitData hit) {
    float ground = abs(ray.direction.y) > 1e-6 ? (GROUND_Y - ray.origin.y) / ray.direction.y : -1.0;
    float limit = ground > 0.001 ? min(hit.t, ground) : hit.t;
    float t;
    vec3 normal;
    uint material;
    if (intersectSidewalk(ray, limit, t, normal)) {
        material = CONCRETE;
    } else {
        if (ground <= 0.001 || ground >= hit.t) return;
        t = ground;
        normal = vec3(0.0, -sign(ray.direction.y), 0.0);
        material = streetMaterial((ray.origin + ray.direction * t).xz);
    }

    vec3 point = ray.origin + ray.direction * t;
    hit = HitData(true, t, point, normal, surfaceColor(material, point, normal, t), 0.0, 0.0, false);
}`;
