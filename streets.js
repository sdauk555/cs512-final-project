const STREET = (() => {
    const NORTH = 1;
    const EAST = 2;
    const SOUTH = 4;
    const WEST = 8;
    // Nine asphalt cells leave room for the plane's 3.4-unit wingspan,
    // with one sidewalk cell on each side.
    const CELLS_PER_TILE = 11;
    const CELL_SIZE = 0.5;
    const TILE_SIZE = CELLS_PER_TILE * CELL_SIZE;
    const MATERIAL = Object.freeze({ grass: 0, asphalt: 1, concrete: 2, stripeX: 3, stripeZ: 4 });
    const SHAPES = Object.freeze({
        end: NORTH,
        straight: NORTH | SOUTH,
        corner: NORTH | EAST,
        tee: NORTH | EAST | WEST,
        cross: NORTH | EAST | SOUTH | WEST,
    });

    function connections(shape, turns) {
        if (!Object.hasOwn(SHAPES, shape) || !Number.isInteger(turns)) {
            throw new RangeError("Expected a street shape and an integer number of quarter turns");
        }
        const rotation = ((turns % 4) + 4) % 4;
        const mask = SHAPES[shape];
        return ((mask << rotation) | (mask >> (4 - rotation))) & 15;
    }

    function road(x, z, shape, turns = 0) {
        return { x, z, road: connections(shape, turns), sidewalk: 0, curbs: false };
    }

    function sidewalk(x, z, shape, turns = 0) {
        return { x, z, road: 0, sidewalk: connections(shape, turns), curbs: false };
    }

    function curb(x, z) {
        return { x, z, road: 0, sidewalk: 0, curbs: true };
    }

    function materialAt(tile, x, z) {
        const center = (CELLS_PER_TILE - 1) / 2;
        const edgeX = x === 0 ? WEST : x === CELLS_PER_TILE - 1 ? EAST : 0;
        const edgeZ = z === 0 ? NORTH : z === CELLS_PER_TILE - 1 ? SOUTH : 0;
        const edge = edgeX | edgeZ;
        if (tile.road && !(edgeX && edgeZ) && (!edge || (tile.road & edge))) {
            if (tile.road === (NORTH | SOUTH) && x === center) return MATERIAL.stripeZ;
            if (tile.road === (EAST | WEST) && z === center) return MATERIAL.stripeX;
            return MATERIAL.asphalt;
        }
        if (tile.curbs && tile.road) return MATERIAL.concrete;
        const arm = x === center ? (z < center ? NORTH : SOUTH) : (x < center ? WEST : EAST);
        if (tile.sidewalk && (x === center || z === center) &&
            ((x === center && z === center) || (tile.sidewalk & arm))) return MATERIAL.concrete;
        return MATERIAL.grass;
    }

    function buildLayout(placements) {
        const tiles = new Map();
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const placement of placements) {
            const { x, z } = placement;
            if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) {
                throw new RangeError("Street placements require integer grid coordinates");
            }
            const key = `${x},${z}`;
            const tile = tiles.get(key) ?? { x, z, road: 0, sidewalk: 0, curbs: false };
            tile.road |= placement.road;
            tile.sidewalk |= placement.sidewalk;
            tile.curbs ||= placement.curbs;
            tiles.set(key, tile);
            minX = Math.min(minX, x);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxZ = Math.max(maxZ, z);
        }

        if (!tiles.size) {
            return { width: 1, height: 1, origin: [0, 0], pixels: new Uint8Array(1) };
        }

        const width = (maxX - minX + 1) * CELLS_PER_TILE;
        const height = (maxZ - minZ + 1) * CELLS_PER_TILE;
        const pixels = new Uint8Array(width * height);
        for (const tile of tiles.values()) {
            for (let z = 0; z < CELLS_PER_TILE; z++) {
                for (let x = 0; x < CELLS_PER_TILE; x++) {
                    const column = (tile.x - minX) * CELLS_PER_TILE + x;
                    const row = (tile.z - minZ) * CELLS_PER_TILE + z;
                    pixels[row * width + column] = materialAt(tile, x, z);
                }
            }
        }
        return { width, height, origin: [(minX - 0.5) * TILE_SIZE, (minZ - 0.5) * TILE_SIZE], pixels };
    }

    return Object.freeze({ road, sidewalk, curb, buildLayout, CELL_SIZE, TILE_SIZE, MATERIAL });
})();

function createStreetPreview() {
    const roads = [
        STREET.road(-1, -1, "corner", 1), STREET.road(0, -1, "straight", 1), STREET.road(1, -1, "corner", 2),
        STREET.road(-1, 0, "straight"), STREET.road(1, 0, "straight"),
        STREET.road(-1, 1, "corner"), STREET.road(0, 1, "tee"), STREET.road(1, 1, "corner", 3),
        STREET.road(0, 0, "end", 2),
    ];
    return STREET.buildLayout([
        ...roads,
        ...roads.map(({ x, z }) => STREET.curb(x, z)),
        STREET.sidewalk(0, -2, "straight"),
    ]);
}
