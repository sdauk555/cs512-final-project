const PLANE = `
uniform vec3 planePos;
uniform mat3 planeRot;
uniform sampler2D planeTex;
uniform sampler2D planeBump;

vec3 triplanar(sampler2D s, vec3 p, vec3 n, float scale) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z);
    vec3 cx = textureLod(s, p.yz * scale, 0.0).rgb;
    vec3 cy = textureLod(s, p.xz * scale, 0.0).rgb;
    vec3 cz = textureLod(s, p.xy * scale, 0.0).rgb;
    return cx * w.x + cy * w.y + cz * w.z;
}

float heightAt(vec3 p, vec3 n, float scale) {
    return triplanar(planeBump, p, n, scale).r;
}

vec3 bumpNormal(vec3 p, vec3 n, float scale, float strength) {
    float e = 0.01;
    float h0 = heightAt(p, n, scale);
    vec3 g = vec3(
        heightAt(p + vec3(e, 0.0, 0.0), n, scale) - h0,
        heightAt(p + vec3(0.0, e, 0.0), n, scale) - h0,
        heightAt(p + vec3(0.0, 0.0, e), n, scale) - h0
    ) / e;

    vec3 gt = g - n * dot(g, n);
    return normalize(n - strength * gt);
}

bool planeBody(Ray r, vec3 c, float radius, float halfLen, out float t, out vec3 n) {
    vec3 o = r.origin - c;
    vec3 nn = vec3(0.0);
    bool h = intersectCylinder(Ray(o.xzy, r.direction.xzy), vec3(0.0), radius, halfLen, t, nn);
    n = nn.xzy;
    return h;
}

bool planeNose(Ray r, vec3 c, float radius, float halfLen, out float t, out vec3 n) {
    vec3 o = r.origin - c;
    vec3 d = r.direction;
    vec3 nn = vec3(0.0);
    bool h = intersectCone(Ray(vec3(o.x, -o.z, o.y), vec3(d.x, -d.z, d.y)), vec3(0.0), radius, halfLen, t, nn);
    n = vec3(nn.x, nn.z, -nn.y);
    return h;
}

bool planeTail(Ray r, vec3 c, float radius, float halfLen, out float t, out vec3 n) {
    vec3 o = r.origin - c;
    vec3 nn = vec3(0.0);
    bool h = intersectCone(Ray(o.xzy, r.direction.xzy), vec3(0.0), radius, halfLen, t, nn);
    n = nn.xzy;
    return h;
}

void testHit(bool didHit, float t, vec3 n, vec3 color, bool glass, inout HitData best) {
    if (didHit && t < best.t) {
      best.hit = true;
      best.t = t;
      best.normal = n;
      best.color = color;
      best.isGlass = glass;
    }
}

HitData intersectPlane(Ray ray, vec3 pos, mat3 rot) {
    HitData best;
    best.hit = false;
    best.t = 1e10;
    best.point = vec3(0.0);
    best.normal = vec3(0.0, 1.0, 0.0);
    best.color = vec3(0.0);
    best.reflectivity = 0.0;
    best.isGlass = false;

    mat3 inv = transpose(rot);
    Ray local = Ray(inv * (ray.origin - pos), inv * ray.direction);

    float t;
    vec3 n;
    bool h;

    if (!intersectSphere(local, vec3(0.0, 0.0, 0.3), 2.6, t, n)) {
        return best;
    }

    vec3 body  = vec3(0.7);
    vec3 glass = vec3(0.85, 0.95, 1.0);

    h = planeBody(local, vec3(0.0, 0.0, 0.2), 0.35, 1.2, t, n);
    testHit(h, t, n, body, false, best);

    h = planeNose(local, vec3(0.0, 0.0, -1.5), 0.35, 0.5, t, n);
    testHit(h, t, n, body, false, best);

    h = planeTail(local, vec3(0.0, 0.0, 2.0), 0.35, 0.6, t, n);
    testHit(h, t, n, body, false, best);

    h = intersectBox(local, vec3(0.0, -0.05, 0.1), vec3(1.7, 0.04, 0.35), t, n);
    testHit(h, t, n, body, false, best);

    h = intersectBox(local, vec3(0.0, 0.05, 2.0), vec3(0.75, 0.03, 0.2), t, n);
    testHit(h, t, n, body, false, best);

    h = intersectBox(local, vec3(0.0, 0.4, 2.0), vec3(0.03, 0.4, 0.25), t, n);
    testHit(h, t, n, body, false, best);

    h = intersectSphere(local, vec3(0.0, 0.25, -0.35), 0.32, t, n);
    testHit(h, t, n, glass, true, best);

    if (best.hit) {
        vec3 localP = local.origin + local.direction * best.t;
        if (!best.isGlass) {
            float scale = 1.0;
            best.color = triplanar(planeTex, localP, best.normal, scale);
            best.normal = bumpNormal(localP, best.normal, scale, 0.01);
            best.reflectivity = 0.5;
        }
    
        best.point = ray.origin + ray.direction * best.t;
        best.normal = normalize(rot * best.normal);
    }

    return best;
}`;