const BUILDING = (() => {
    const WIDTH = 2.0, DEPTH = 2.0, FLOOR_HEIGHT = 1.25;
    const MAX_FLOORS = 16;
    const parts = [];
    const masonry = [0.72, 0.66, 0.54];
    const frame = [0.12, 0.17, 0.20];
    const glass = [0.85, 0.92, 0.98];
    function box(center, halfSize, color, isGlass = false) {
        parts.push({ center, halfSize, color, isGlass });
    }

    box([0, 0.05, 0], [1, 0.05, 1], masonry);
    box([0, FLOOR_HEIGHT - 0.05, 0], [1, 0.05, 1], masonry);
    for (let side = 0; side < 4; side++) {
        function facade(x, y, z, hx, hy, hz, color, isGlass = false) {
            const centers = [[x, y, z], [-z, y, x], [-x, y, -z], [z, y, -x]];
            box(centers[side], side % 2 ? [hz, hy, hx] : [hx, hy, hz], color, isGlass);
        }
        facade(0, 0.22, 0.94, 0.88, 0.12, 0.06, masonry);
        facade(0, 1.12, 0.94, 0.88, 0.03, 0.06, masonry);
        facade(-0.94, 0.625, 0.94, 0.06, 0.525, 0.06, masonry);
        facade(0, 0.715, 0.94, 0.025, 0.375, 0.07, frame);
        facade(0, 0.36, 0.94, 0.88, 0.02, 0.07, frame);
        facade(0, 1.07, 0.94, 0.88, 0.02, 0.07, frame);
        facade(-0.88, 0.715, 0.94, 0.02, 0.375, 0.07, frame);
        facade(0.88, 0.715, 0.94, 0.02, 0.375, 0.07, frame);
        facade(-0.4425, 0.715, 0.94, 0.4175, 0.335, 0.012, glass, true);
        facade(0.4425, 0.715, 0.94, 0.4175, 0.335, 0.012, glass, true);
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

    function upload(gl, program, floors) {
        if (floors.length > MAX_FLOORS) throw new RangeError(`At most ${MAX_FLOORS} floor instances`);
        gl.uniform1i(gl.getUniformLocation(program, "buildingFloorCount"), floors.length);
        if (floors.length) gl.uniform3fv(gl.getUniformLocation(program, "buildingFloors[0]"), floors.flat());
    }

    const vector = values => `vec3(${values.map(v => v.toFixed(4)).join(", ")})`;
    const shader = `
uniform int buildingFloorCount;
uniform vec3 buildingFloors[${MAX_FLOORS}];

void buildingPart(Ray ray, vec3 center, vec3 size, vec3 color, bool glass, inout HitData hit) {
    float t;
    vec3 normal;
    if (intersectBox(ray, center, size, t, normal) && t < hit.t) {
        hit = HitData(true, t, ray.origin + ray.direction * t, normal,
                      color, glass ? 0.96 : 0.08, glass ? 0.9 : 0.25, false);
    }
}

void intersectBuildings(Ray ray, inout HitData hit) {
    for (int i = 0; i < ${MAX_FLOORS}; i++) {
        if (i >= buildingFloorCount) break;
        Ray local = Ray(ray.origin - buildingFloors[i], ray.direction);
        float t;
        vec3 normal;
        if (!intersectBox(local, vec3(0.0, ${FLOOR_HEIGHT / 2}, 0.0),
                          vec3(1.0, ${FLOOR_HEIGHT / 2}, 1.0), t, normal)) continue;
        ${parts.map(p => `buildingPart(local, ${vector(p.center)}, ${vector(p.halfSize)}, ${vector(p.color)}, ${p.isGlass}, hit);`).join("\n        ")}
    }
    if (hit.hit) hit.point = ray.origin + ray.direction * hit.t;
}`;

    return Object.freeze({ WIDTH, DEPTH, FLOOR_HEIGHT, MAX_FLOORS, floor, block, upload, shader });
})();

function createBuildingPreview() {
    return [BUILDING.floor(-5, 0), ...BUILDING.block(5, -1, 2, 2, 3)];
}
