// Lantern Reach: a small cave-and-lighthouse expedition map. Pure data.
export const MAX_DAY = 14;
export const START_POOL = { oil: 12, rations: 10, rope: 4 };
export const RESOURCES = ["oil", "rations", "rope"];

export const NODES = {
  camp: { name: "Lantern Camp", x: 90, y: 300, note: "Where the party starts. Safe to rest." },
  stair: { name: "Lower Stair", x: 230, y: 300, note: "A worn crossroads." },
  cistern: { name: "Mirror Cistern", x: 360, y: 150, gather: { oil: 3 }, goal: "survey", note: "Still water and lamp oil seeps." },
  gallery: { name: "Fungus Gallery", x: 360, y: 450, gather: { rations: 3 }, note: "Edible caps and a dry floor." },
  bridge: { name: "Chain Bridge", x: 520, y: 300, gather: { rope: 1 }, note: "Old chains hang from the span." },
  shaft: { name: "Collapsed Shaft", x: 440, y: 40, note: "A steep shortcut. Rock is loose." },
  lighthouse: { name: "Old Lighthouse", x: 700, y: 120, goal: "beacon", note: "The beacon lamp is dark." },
  vault: { name: "Salt Vault", x: 700, y: 440, goal: "vault", note: "A sealed door, rope eyes on the frame." },
};

// Undirected routes. cost is what one crossing consumes from the shared pool.
export const EDGES = [
  { id: "camp-stair", a: "camp", b: "stair", cost: { oil: 1, rations: 1 } },
  { id: "stair-cistern", a: "stair", b: "cistern", cost: { oil: 1 } },
  { id: "stair-gallery", a: "stair", b: "gallery", cost: { oil: 1, rations: 1 } },
  { id: "cistern-bridge", a: "cistern", b: "bridge", cost: { oil: 1, rations: 1 } },
  { id: "gallery-bridge", a: "gallery", b: "bridge", cost: { oil: 1, rations: 1 } },
  { id: "bridge-lighthouse", a: "bridge", b: "lighthouse", cost: { oil: 2, rations: 1 } },
  { id: "bridge-vault", a: "bridge", b: "vault", cost: { oil: 1, rope: 1, rations: 1 } },
  { id: "stair-shaft", a: "stair", b: "shaft", cost: { oil: 1, rope: 1 } },
  { id: "shaft-lighthouse", a: "shaft", b: "lighthouse", cost: { oil: 1, rope: 1 } },
];

export const GOALS = {
  survey: { name: "Survey the cistern", node: "cistern", cost: { oil: 1 }, text: "Chart the Mirror Cistern." },
  beacon: { name: "Light the beacon", node: "lighthouse", cost: { oil: 3 }, text: "Relight the Old Lighthouse." },
  vault: { name: "Open the Salt Vault", node: "vault", cost: { oil: 1, rope: 2 }, text: "Open the sealed vault door." },
};

// Situations: active windows are public in the forecast. Tags the capsule can name are "forecast";
// others are unforeseen and always stop the absent player's plan.
export const FORECAST_TAGS = {
  loose_rock: "loose rock",
  high_wind: "high wind",
  flooded: "flooded passage",
  spore_bloom: "spore bloom",
};
export const SITUATIONS = [
  { node: "shaft", from: 1, to: 14, tag: "loose_rock", text: "Loose rock hangs over the shaft." },
  { node: "bridge", from: 3, to: 6, tag: "high_wind", text: "A hard wind rakes the Chain Bridge." },
  { node: "cistern", from: 5, to: 8, tag: "flooded", text: "Meltwater floods the Mirror Cistern." },
  { node: "gallery", from: 4, to: 7, tag: "spore_bloom", text: "Spores cloud the Fungus Gallery." },
  { node: "bridge", from: 8, to: 9, tag: "stranger", text: "A signal-keeper blocks the bridge and offers a trade nobody planned for." },
  { node: "lighthouse", from: 10, to: 14, tag: "tide_bell", text: "A tide bell tolls inside the lighthouse. Nobody has heard it before." },
];

export const activeSituation = (node, day) =>
  SITUATIONS.find((s) => s.node === node && day >= s.from && day <= s.to) || null;

export const neighbors = (id) =>
  EDGES.filter((e) => e.a === id || e.b === id).map((e) => ({ to: e.a === id ? e.b : e.a, edge: e }));

export const edgeBetween = (a, b) => EDGES.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

export const publicWorld = () => ({ MAX_DAY, START_POOL, NODES, EDGES, GOALS, SITUATIONS, FORECAST_TAGS });
