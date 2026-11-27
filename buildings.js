const BUILDING = (() => {
    // Architectural dimensions relative to the jet's 4.6-unit length.
    const WIDTH = 6.0, DEPTH = 6.0, FLOOR_HEIGHT = 1.5;
    const SKYSCRAPER_WIDTH = 11.2, SKYSCRAPER_DEPTH = 9.6;
    const MAX_FLOORS = 16;
    const MAX_SKYSCRAPERS = 4;
    const WINDOW_BAYS = 9;
    const parts = [];
    const masonry = [0.72, 0.67, 0.56];
    const frame = [0.20, 0.21, 0.19];
    const glass = [0.30, 0.40, 0.46];
    function box(center, halfSize, color, isGlass = false) {
        parts.push({ center, halfSize, color, isGlass });
    }

    box([0, 0.05, 0], [WIDTH / 2, 0.05, DEPTH / 2], masonry);
    box([0, FLOOR_HEIGHT - 0.05, 0], [WIDTH / 2, 0.05, DEPTH / 2], masonry);
    for (let side = 0; side < 4; side++) {
        function facade(x, y, z, hx, hy, hz, color, isGlass = false) {
            const centers = [[x, y, z], [-z, y, x], [-x, y, -z], [z, y, -x]];
            box(centers[side], side % 2 ? [hz, hy, hx] : [hx, hy, hz], color, isGlass);
        }
        const edge = WIDTH / 2 - 0.06;
        const span = WIDTH / 2 - 0.12;
        const windowBottom = 0.44, windowTop = FLOOR_HEIGHT - 0.22;
        const windowY = (windowBottom + windowTop) / 2;
        const windowHalfHeight = (windowTop - windowBottom) / 2;
        facade(0, 0.25, edge, span, 0.15, 0.06, masonry);
        facade(0, FLOOR_HEIGHT - 0.11, edge, span, 0.06, 0.06, masonry);
        facade(-edge, FLOOR_HEIGHT / 2, edge, 0.06, FLOOR_HEIGHT / 2 - 0.1, 0.06, masonry);
        facade(0, windowBottom - 0.02, edge, span, 0.02, 0.06, frame);
        facade(0, windowTop + 0.02, edge, span, 0.02, 0.06, frame);
        facade(-span, windowY, edge, 0.02, windowHalfHeight + 0.02, 0.06, frame);
        facade(span, windowY, edge, 0.02, windowHalfHeight + 0.02, 0.06, frame);
        // Add bays rather than stretching windows as the footprint grows.
        const bays = WINDOW_BAYS;
        const bayWidth = 2 * span / bays;
        // A shared pane sits behind the stone piers; mullions are shaded below
        // so additional bays do not multiply glass intersection tests.
        facade(0, windowY, edge, span, windowHalfHeight, 0.012, glass, true);
        for (let bay = 1; bay < bays; bay++) {
            const x = -span + bay * bayWidth;
            facade(x, FLOOR_HEIGHT / 2, edge + 0.02, 0.055, FLOOR_HEIGHT / 2 - 0.1, 0.04, masonry);
        }
    }

    function floor(x, z, level = 0, baseY = -0.75) {
        if (![x, z, baseY].every(Number.isFinite) || !Number.isInteger(level) || level < 0) {
            throw new RangeError("A floor needs finite coordinates and a nonnegative integer level");
        }
        return [x, baseY + level * FLOOR_HEIGHT, z];
    }

    function block(x, z, columns = 1, rows = 1, levels = 1, baseY = -0.75) {
        if (![columns, rows, levels].every(n => Number.isSafeInteger(n) && n > 0) ||
            columns * rows * levels > MAX_FLOORS) {
            throw new RangeError(`A block needs positive integer dimensions and at most ${MAX_FLOORS} modules`);
        }
        const floors = [];
        for (let level = 0; level < levels; level++) {
            for (let row = 0; row < rows; row++) {
                for (let column = 0; column < columns; column++) {
                    floors.push(floor(x + column * WIDTH, z + row * DEPTH, level, baseY));
                }
            }
        }
        return floors;
    }

    // The five setback tiers are shaded procedurally, so tall towers do not
    // consume one detailed floor instance for every story.
    function skyscraper(x, z, levels = 24, baseY = -0.75) {
        if (![x, z, baseY].every(Number.isFinite) || !Number.isSafeInteger(levels) || levels < 8 || levels > 80) {
            throw new RangeError("A skyscraper needs finite coordinates and 8 to 80 stories");
        }
        return [x, baseY, z, levels * FLOOR_HEIGHT];
    }

    function upload(gl, program, floors, skyscrapers = []) {
        if (floors.length > MAX_FLOORS) throw new RangeError(`At most ${MAX_FLOORS} floor instances`);
        if (skyscrapers.length > MAX_SKYSCRAPERS) throw new RangeError(`At most ${MAX_SKYSCRAPERS} skyscrapers`);
        gl.uniform1i(gl.getUniformLocation(program, "buildingFloorCount"), floors.length);
        if (floors.length) gl.uniform3fv(gl.getUniformLocation(program, "buildingFloors[0]"), floors.flat());
        gl.uniform1i(gl.getUniformLocation(program, "skyscraperCount"), skyscrapers.length);
        if (skyscrapers.length) gl.uniform4fv(gl.getUniformLocation(program, "skyscrapers[0]"), skyscrapers.flat());
    }

    const vector = values => `vec3(${values.map(v => v.toFixed(4)).join(", ")})`;
    const shader = `
uniform int buildingFloorCount;
uniform vec3 buildingFloors[${MAX_FLOORS}];
uniform int skyscraperCount;
uniform vec4 skyscrapers[${MAX_SKYSCRAPERS}];
const float SKYSCRAPER_FOOTPRINT_SCALE = ${(SKYSCRAPER_WIDTH / 5.6).toFixed(2)};

void buildingPart(Ray ray, vec3 center, vec3 size, vec3 color, bool glass, inout HitData hit) {
    float t;
    vec3 normal;
    if (intersectBox(ray, center, size, t, normal) && t < hit.t) {
        vec3 point = ray.origin + ray.direction * t;
        vec3 partColor = color;
        bool window = glass;
        if (glass) {
            float across = abs(normal.z) > 0.5 ? point.x : point.z;
            float bayWidth = ${((WIDTH - 0.24) / WINDOW_BAYS).toFixed(4)};
            float u = fract((across + ${(WIDTH / 2 - 0.12).toFixed(4)}) / bayWidth);
            if (abs(u - 0.5) * bayWidth < 0.012) {
                partColor = ${vector(frame)};
                window = false;
            }
        }
        hit = HitData(true, t, point, normal,
                      partColor, window ? 0.22 : 0.08, window ? 0.35 : 0.25, false);
    }
}

void skyscraperTier(Ray ray, float bottom, float top, vec2 footprint, bool crown, inout HitData hit) {
    vec3 center = vec3(0.0, (bottom + top) * 0.5, 0.0);
    vec3 size = vec3(footprint.x, (top - bottom) * 0.5, footprint.y);
    float t;
    vec3 normal;
    if (!intersectBox(ray, center, size, t, normal) || t >= hit.t) return;
    vec3 p = ray.origin + ray.direction * t;
    vec3 stone = ${vector(masonry)};
    vec3 color = stone;
    bool window = false;
    if (abs(normal.y) < 0.5) {
        bool front = abs(normal.z) > 0.5;
        float width = 2.0 * (front ? footprint.x : footprint.y);
        float across = (front ? p.x : p.z) + width * 0.5;
        float bays = max(1.0, floor(width / 0.65));
        float bay = across / width * bays;
        float u = fract(bay);
        float story = p.y / ${FLOOR_HEIGHT.toFixed(2)};
        float v = fract(story);
        // Deep spandrels between stories; pale piers run vertically past them.
        color = mix(vec3(0.39, 0.37, 0.32), stone, step(u, 0.15) + step(0.85, u));
        window = u > 0.20 && u < 0.80 && v > 0.22 && v < 0.85;
        if (window) {
            float variation = fract(sin(dot(vec2(floor(bay), floor(story)), vec2(12.9898, 78.233))) * 43758.5453);
            color = mix(vec3(0.22, 0.31, 0.36), ${vector(glass)}, variation);
            // A fine bronze mullion divides each recessed window bay.
            if (abs(u - 0.5) < 0.025) { color = ${vector(frame)}; window = false; }
        }
        if (crown) {
            float rib = step(0.28, u) * step(u, 0.72);
            color = mix(vec3(0.60, 0.62, 0.60), vec3(0.31, 0.36, 0.36), rib);
            window = false;
        }
        // A stone cornice caps every setback and catches light at its edge.
        if (top - p.y < 0.14) { color = stone * 1.08; window = false; }
    } else {
        color = crown ? vec3(0.48, 0.52, 0.51) : vec3(0.38, 0.37, 0.33);
    }
    hit = HitData(true, t, p, normal, color,
                  window ? 0.22 : (crown ? 0.16 : 0.06), window ? 0.35 : 0.22, false);
}

void intersectSkyscrapers(Ray ray, inout HitData hit) {
    for (int i = 0; i < ${MAX_SKYSCRAPERS}; i++) {
        if (i >= skyscraperCount) break;
        vec4 tower = skyscrapers[i];
        Ray local = Ray(ray.origin - tower.xyz, ray.direction);
        float h = tower.w;
        float t;
        vec3 normal;
        // One bounds test rejects the entire tower, including its spire.
        if (!intersectBox(local, vec3(0.0, (h + 3.8) * 0.5, 0.0),
                          vec3(${SKYSCRAPER_WIDTH / 2}, (h + 3.8) * 0.5, ${SKYSCRAPER_DEPTH / 2}), t, normal)) continue;
        skyscraperTier(local, 0.0, h * 0.125, vec2(2.8, 2.4) * SKYSCRAPER_FOOTPRINT_SCALE, false, hit);
        skyscraperTier(local, h * 0.125, h * 0.583333, vec2(2.1, 1.8) * SKYSCRAPER_FOOTPRINT_SCALE, false, hit);
        skyscraperTier(local, h * 0.583333, h * 0.791667, vec2(1.7, 1.45) * SKYSCRAPER_FOOTPRINT_SCALE, false, hit);
        skyscraperTier(local, h * 0.791667, h * 0.916667, vec2(1.25, 1.1) * SKYSCRAPER_FOOTPRINT_SCALE, false, hit);
        skyscraperTier(local, h * 0.916667, h, vec2(0.8, 0.7) * SKYSCRAPER_FOOTPRINT_SCALE, true, hit);
        // A tapered metal pinnacle and antenna finish the skyline silhouette.
        if (intersectCone(local, vec3(0.0, h + 0.9, 0.0), 0.65 * SKYSCRAPER_FOOTPRINT_SCALE, 0.9, t, normal) && t < hit.t) {
            hit = HitData(true, t, local.origin + local.direction * t, normal,
                          vec3(0.60, 0.64, 0.63), 0.18, 0.35, false);
        }
        if (intersectCylinder(local, vec3(0.0, h + 2.7, 0.0), 0.045, 1.1, t, normal) && t < hit.t) {
            hit = HitData(true, t, local.origin + local.direction * t, normal,
                          vec3(0.47, 0.51, 0.50), 0.18, 0.35, false);
        }
    }
}

void intersectBuildings(Ray ray, inout HitData hit) {
    for (int i = 0; i < ${MAX_FLOORS}; i++) {
        if (i >= buildingFloorCount) break;
        Ray local = Ray(ray.origin - buildingFloors[i], ray.direction);
        float t;
        vec3 normal;
        if (!intersectBox(local, vec3(0.0, ${FLOOR_HEIGHT / 2}, 0.0),
                          vec3(${WIDTH / 2}, ${FLOOR_HEIGHT / 2}, ${DEPTH / 2}), t, normal)) continue;
        ${parts.map(p => `buildingPart(local, ${vector(p.center)}, ${vector(p.halfSize)}, ${vector(p.color)}, ${p.isGlass}, hit);`).join("\n        ")}
    }
    intersectSkyscrapers(ray, hit);
    if (hit.hit) hit.point = ray.origin + ray.direction * hit.t;
}`;

    return Object.freeze({ WIDTH, DEPTH, FLOOR_HEIGHT, SKYSCRAPER_WIDTH, SKYSCRAPER_DEPTH,
                           MAX_FLOORS, MAX_SKYSCRAPERS, floor, block, skyscraper, upload, shader });
})();

function createBuildingPreview() {
    // Keep the facades just outside the three-tile-wide street preview.
    const setback = STREET.TILE_SIZE * 1.5 + BUILDING.WIDTH / 2;
    return [BUILDING.floor(-setback, BUILDING.DEPTH + 1),
            ...BUILDING.block(-setback - BUILDING.WIDTH, -BUILDING.DEPTH, 2, 2, 3)];
}

function createSkyscraperPreview() {
    const setback = STREET.TILE_SIZE * 1.5 + BUILDING.SKYSCRAPER_WIDTH / 2 + 0.3;
    return [BUILDING.skyscraper(setback, 0)];
}
