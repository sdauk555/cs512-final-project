// Seeded blocks, tightly packed lots, and a spatial index for analytic ray tracing.
const CITY = (() => {
    const WIDTH = 352, DEPTH = 308, GRID_CELL = 12, CELL_CAPACITY = 24;
    const BASE_Y = -0.75;

    function generate(seed = 512) {
        let state = seed >>> 0;
        const random = () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };
        const between = (a, b) => a + (b - a) * random();
        const roads = [], blocks = [], buildings = [];
        const origin = [-WIDTH / 2, -DEPTH / 2];
        function road(x0, z0, x1, z1, axis, width) {
            roads.push({ x0, z0, x1, z1, axis, width });
        }
        // A perimeter and one continuous east-west avenue anchor the network.
        const edge = 3.25;
        road(-176, -154 + edge, 176, -154 + edge, 0, 4.5);
        road(-176, 154 - edge, 176, 154 - edge, 0, 4.5);
        road(-176 + edge, -154, -176 + edge, 154, 1, 4.5);
        road(176 - edge, -154, 176 - edge, 154, 1, 4.5);
        road(-176, 0, 176, 0, 0, 4.5);

        function divide(x0, z0, x1, z1, depth = 0) {
            const w = x1 - x0, d = z1 - z0;
            if (Math.max(w, d) < between(34, 46)) {
                blocks.push({ x0, z0, x1, z1 });
                return;
            }
            const axis = w > d * 1.25 ? 0 : d > w * 1.25 ? 1 : (random() < 0.5 ? 0 : 1);
            const length = axis === 0 ? w : d;
            if (length < 43) { blocks.push({ x0, z0, x1, z1 }); return; }
            const width = depth < 2 ? 6.5 : 4.5;
            const half = width / 2 + 0.75;
            const start = axis === 0 ? x0 : z0;
            const cut = start + Math.max(18 + half, Math.min(length - 18 - half, length * between(0.36, 0.64)));
            // Children split independently: local streets end at an avenue,
            // producing offset junctions and unequal blocks instead of a lattice.
            if (axis === 0) {
                road(cut, z0 - 4, cut, z1 + 4, 1, width);
                divide(x0, z0, cut - half, z1, depth + 1);
                divide(cut + half, z0, x1, z1, depth + 1);
            } else {
                road(x0 - 4, cut, x1 + 4, cut, 0, width);
                divide(x0, z0, x1, cut - half, depth + 1);
                divide(x0, cut + half, x1, z1, depth + 1);
            }
        }
        divide(-169.5, -147.5, 169.5, -3.25);
        divide(-169.5, 3.25, 169.5, 147.5);

        for (const block of blocks) {
            const w = block.x1 - block.x0, d = block.z1 - block.z0;
            const columns = Math.max(1, Math.round(w / between(8, 12)));
            const rows = Math.max(1, Math.round(d / between(8, 12)));
            // Unequal frontage sizes maintain continuous street walls without
            // repeating the same building footprint across every block.
            const cuts = (start, length, count) => {
                const weights = Array.from({ length: count }, () => between(0.8, 1.2));
                const total = weights.reduce((a, b) => a + b, 0);
                const positions = [start];
                for (const weight of weights) positions.push(positions.at(-1) + length * weight / total);
                return positions;
            };
            const xs = cuts(block.x0, w, columns), zs = cuts(block.z0, d, rows);
            for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
                const x = (xs[column] + xs[column + 1]) / 2;
                const z = (zs[row] + zs[row + 1]) / 2;
                const gap = between(0.35, 0.7);
                const downtown = Math.exp(-((x + 25) ** 2 / 7200 + (z + 26) ** 2 / 5000));
                const landmark = downtown > 0.52 && random() < 0.13;
                const levels = landmark ? Math.round(between(30, 50)) : Math.round(between(3, 8) + downtown * between(3, 21));
                const style = landmark ? 2 : Math.floor(random() * 4);
                const palettes = [[0.67, 0.62, 0.51], [0.46, 0.25, 0.17], [0.62, 0.65, 0.65], [0.24, 0.37, 0.42]];
                const tint = between(0.86, 1.12);
                buildings.push({ x, z, height: levels * BUILDING.FLOOR_HEIGHT,
                    halfWidth: (xs[column + 1] - xs[column] - gap) / 2,
                    halfDepth: (zs[row + 1] - zs[row] - gap) / 2,
                    style, variation: random(), color: palettes[style].map(v => v * tint) });
            }
        }

        const width = WIDTH / STREET.CELL_SIZE, height = DEPTH / STREET.CELL_SIZE;
        const pixels = new Uint8Array(width * height).fill(STREET.MATERIAL.concrete);
        const coverage = new Uint8Array(width * height);
        for (const r of roads) {
            const half = r.width / 2;
            const x0 = Math.max(0, Math.floor((r.x0 - (r.axis === 1 ? half : 0) - origin[0]) / STREET.CELL_SIZE));
            const x1 = Math.min(width, Math.ceil((r.x1 + (r.axis === 1 ? half : 0) - origin[0]) / STREET.CELL_SIZE));
            const z0 = Math.max(0, Math.floor((r.z0 - (r.axis === 0 ? half : 0) - origin[1]) / STREET.CELL_SIZE));
            const z1 = Math.min(height, Math.ceil((r.z1 + (r.axis === 0 ? half : 0) - origin[1]) / STREET.CELL_SIZE));
            for (let iz = z0; iz < z1; iz++) for (let ix = x0; ix < x1; ix++) {
                const i = iz * width + ix;
                const across = r.axis === 0 ? origin[1] + (iz + 0.5) * STREET.CELL_SIZE - r.z0 : origin[0] + (ix + 0.5) * STREET.CELL_SIZE - r.x0;
                coverage[i]++;
                pixels[i] = Math.abs(across) < STREET.CELL_SIZE / 2
                    ? (r.axis === 0 ? STREET.MATERIAL.stripeX : STREET.MATERIAL.stripeZ) : STREET.MATERIAL.asphalt;
            }
        }
        for (let i = 0; i < pixels.length; i++) if (coverage[i] > 1) pixels[i] = STREET.MATERIAL.asphalt;

        const gridWidth = Math.ceil(WIDTH / GRID_CELL), gridHeight = Math.ceil(DEPTH / GRID_CELL);
        const cells = Array.from({ length: gridWidth * gridHeight }, () => []);
        buildings.forEach((b, index) => {
            const minX = Math.floor((b.x - b.halfWidth - origin[0]) / GRID_CELL);
            const maxX = Math.floor((b.x + b.halfWidth - origin[0]) / GRID_CELL);
            const minZ = Math.floor((b.z - b.halfDepth - origin[1]) / GRID_CELL);
            const maxZ = Math.floor((b.z + b.halfDepth - origin[1]) / GRID_CELL);
            for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) cells[z * gridWidth + x].push(index + 1);
        });
        const maxCellCount = Math.max(...cells.map(cell => cell.length));
        if (maxCellCount > CELL_CAPACITY) throw new RangeError("City spatial index capacity exceeded");
        const indices = new Int32Array(cells.length * CELL_CAPACITY);
        cells.forEach((cell, i) => indices.set(cell, i * CELL_CAPACITY));
        return { seed, buildings, roads, blocks, streets: { width, height, origin, pixels },
            gridWidth, gridHeight, indices, maxCellCount,
            maxHeight: Math.max(...buildings.map(b => b.height)) + 3 };
    }

    function upload(gl, program, city) {
        const data = new Float32Array(city.buildings.length * 12);
        city.buildings.forEach((b, i) => data.set([b.x, BASE_Y, b.z, b.height,
            b.halfWidth, b.halfDepth, b.style, b.variation, ...b.color, 0], i * 12));
        function texture(unit, internal, width, height, format, type, pixels) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
            gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, pixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        }
        texture(3, gl.RGBA32F, 3, city.buildings.length, gl.RGBA, gl.FLOAT, data);
        texture(4, gl.R32I, CELL_CAPACITY, city.gridWidth * city.gridHeight, gl.RED_INTEGER, gl.INT, city.indices);
        gl.uniform1i(gl.getUniformLocation(program, "cityBuildings"), 3);
        gl.uniform1i(gl.getUniformLocation(program, "cityIndex"), 4);
        gl.uniform2i(gl.getUniformLocation(program, "cityGridSize"), city.gridWidth, city.gridHeight);
        gl.uniform1f(gl.getUniformLocation(program, "cityMaxHeight"), city.maxHeight);
    }

    const shader = `
uniform highp sampler2D cityBuildings;
uniform highp isampler2D cityIndex;
uniform ivec2 cityGridSize;
uniform float cityMaxHeight;
const vec2 CITY_ORIGIN = vec2(${-WIDTH / 2}.0, ${-DEPTH / 2}.0);
const float CITY_CELL = ${GRID_CELL}.0;

void cityPart(Ray ray, vec3 center, vec3 size, vec3 stone, float style, float variation,
              inout HitData hit) {
    float t; vec3 normal;
    if (!intersectBox(ray, center, size, t, normal) || t >= hit.t) return;
    vec3 p = ray.origin + ray.direction * t;
    vec3 color = stone;
    bool window = false;
    if (abs(normal.y) < 0.5) {
        float across = abs(normal.z) > 0.5 ? p.x : p.z;
        float u = fract(across / (style == 3.0 ? 0.85 : 0.72));
        float v = fract(p.y / ${BUILDING.FLOOR_HEIGHT});
        window = u > 0.17 && u < 0.83 && v > 0.23 && v < 0.84;
        if (style == 3.0) window = u > 0.04 && u < 0.96 && v > 0.10;
        if (window) {
            float pane = fract(sin(dot(floor(vec2(across / 0.72, p.y / 1.5)), vec2(12.9898, 78.233)) + variation * 51.0) * 43758.5453);
            color = mix(vec3(0.16, 0.25, 0.31), vec3(0.40, 0.53, 0.59), pane * 0.65 + variation * 0.35);
        } else if (style == 1.0) {
            vec2 brick = vec2(p.y / 0.18, across / 0.42 + step(0.5, fract(p.y / 0.36)) * 0.5);
            if (fract(brick.x) < 0.08 || fract(brick.y) < 0.05) color *= 0.77;
        }
        if (center.y + size.y - p.y < 0.16) { color = stone * 1.15; window = false; }
    } else {
        color = stone * 0.57;
        vec2 edge = size.xz - abs(p.xz - center.xz);
        if (min(edge.x, edge.y) < 0.15) color = stone;
    }
    hit = HitData(true, t, p, normal, color, window ? 0.16 : 0.0, window ? 0.3 : 0.08, false);
}

void cityBuilding(Ray ray, int id, inout HitData hit) {
    vec4 b = texelFetch(cityBuildings, ivec2(0, id), 0);
    vec4 info = texelFetch(cityBuildings, ivec2(1, id), 0);
    vec3 stone = texelFetch(cityBuildings, ivec2(2, id), 0).rgb;
    Ray local = Ray(ray.origin - b.xyz, ray.direction);
    float t; vec3 n;
    if (!intersectBox(local, vec3(0.0, (b.w + 2.5) * 0.5, 0.0), vec3(info.x, (b.w + 2.5) * 0.5, info.y), t, n)) return;
    if (info.z == 2.0 && b.w > 22.0) {
        cityPart(local, vec3(0.0, b.w * 0.09, 0.0), vec3(info.x, b.w * 0.09, info.y), stone, info.z, info.w, hit);
        cityPart(local, vec3(0.0, b.w * 0.43, 0.0), vec3(info.x * 0.82, b.w * 0.25, info.y * 0.82), stone, info.z, info.w, hit);
        cityPart(local, vec3(0.0, b.w * 0.77, 0.0), vec3(info.x * 0.64, b.w * 0.09, info.y * 0.64), stone, info.z, info.w, hit);
        cityPart(local, vec3(0.0, b.w * 0.93, 0.0), vec3(info.x * 0.43, b.w * 0.07, info.y * 0.43), stone, info.z, info.w, hit);
        cityPart(local, vec3(0.0, b.w + 1.2, 0.0), vec3(0.10, 1.2, 0.10), vec3(0.43), 0.0, info.w, hit);
    } else {
        float setback = info.z == 0.0 && b.w > 16.0 ? 0.78 : 1.0;
        float podium = setback < 1.0 ? 0.22 : 1.0;
        cityPart(local, vec3(0.0, b.w * podium * 0.5, 0.0), vec3(info.x, b.w * podium * 0.5, info.y), stone, info.z, info.w, hit);
        if (setback < 1.0) cityPart(local, vec3(0.0, b.w * (1.0 + podium) * 0.5, 0.0), vec3(info.x * setback, b.w * (1.0 - podium) * 0.5, info.y * setback), stone, info.z, info.w, hit);
        // Small roof houses break up flat silhouettes without per-story geometry.
        cityPart(local, vec3(info.x * 0.25, b.w + 0.55, 0.0), vec3(info.x * 0.24, 0.55, info.y * 0.28), stone * 0.75, 0.0, info.w, hit);
    }
}

void intersectCity(Ray ray, inout HitData hit) {
    vec3 lower = vec3(CITY_ORIGIN.x, ${BASE_Y}, CITY_ORIGIN.y);
    vec3 upper = vec3(CITY_ORIGIN.x + ${WIDTH}.0, cityMaxHeight, CITY_ORIGIN.y + ${DEPTH}.0);
    float enter = 0.001, leave = hit.t;
    for (int axis = 0; axis < 3; axis++) {
        if (abs(ray.direction[axis]) < 1e-7) {
            if (ray.origin[axis] < lower[axis] || ray.origin[axis] > upper[axis]) return;
        } else {
            vec2 times = (vec2(lower[axis], upper[axis]) - ray.origin[axis]) / ray.direction[axis];
            enter = max(enter, min(times.x, times.y));
            leave = min(leave, max(times.x, times.y));
        }
    }
    if (enter >= leave) return;
    vec2 start = (ray.origin.xz + ray.direction.xz * (enter + 0.0001) - CITY_ORIGIN) / CITY_CELL;
    ivec2 cell = clamp(ivec2(floor(start)), ivec2(0), cityGridSize - 1);
    ivec2 stepTo = ivec2(sign(ray.direction.xz));
    vec2 next = vec2(1e20), delta = vec2(1e20);
    for (int axis = 0; axis < 2; axis++) {
        if (abs(ray.direction.xz[axis]) < 1e-7) continue;
        float boundary = CITY_ORIGIN[axis] + float(cell[axis] + max(stepTo[axis], 0)) * CITY_CELL;
        next[axis] = (boundary - ray.origin.xz[axis]) / ray.direction.xz[axis];
        delta[axis] = CITY_CELL / abs(ray.direction.xz[axis]);
    }
    for (int step = 0; step < 128; step++) {
        int row = cell.y * cityGridSize.x + cell.x;
        for (int slot = 0; slot < ${CELL_CAPACITY}; slot++) {
            int id = texelFetch(cityIndex, ivec2(slot, row), 0).r - 1;
            if (id < 0) break;
            cityBuilding(ray, id, hit);
        }
        float exitCell = min(next.x, next.y);
        if (hit.t <= exitCell || exitCell >= leave) break;
        if (next.x == exitCell) { cell.x += stepTo.x; next.x += delta.x; }
        if (next.y == exitCell) { cell.y += stepTo.y; next.y += delta.y; }
        if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, cityGridSize))) break;
    }
    if (hit.hit) hit.point = ray.origin + ray.direction * hit.t;
}`;

    return Object.freeze({ generate, upload, shader, WIDTH, DEPTH, GRID_CELL, CELL_CAPACITY });
})();
