import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";

const saved = new Map([
  ["zcs:glm52AutoSwitchEnabled", "1"],
  ["zcs:glm52AutoSwitchThresholdWan", "42"],
]);
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, String(value)),
};
globalThis.document = {
  documentElement: { dataset: {}, style: {}, setAttribute() {} },
  body: { style: {} },
  getElementById: () => null,
};

const bundled = await build({
  stdin: {
    contents: 'export { useStore } from "./src/store"; export * from "./src/lib/modelQuota";',
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [{
    name: "mock-tauri",
    setup(b) {
      b.onResolve({ filter: /^@tauri-apps\/api\/(window|core)$/ }, (args) => ({ path: args.path, namespace: "mock-tauri" }));
      b.onLoad({ filter: /.*/, namespace: "mock-tauri" }, () => ({ contents: `
        export const getCurrentWindow = () => ({ setBackgroundColor: async () => {} });
        export const invoke = async () => { throw new Error("Unexpected native API call in unit test"); };
      ` }));
    },
  }],
});
const { useStore, modelRemaining, computeModelPoolStats } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const initial = useStore.getState();

const balance = (show_name, remaining_units) => ({
  show_name, remaining_units, total_units: 3_000_000,
  used_units: 3_000_000 - remaining_units, unit_type: null, period: null,
});
const quota = (...balances) => ({
  plan_name: "Start Plan", plan_description: null, plan_status: null,
  plan_ends_at: null, balances,
});
const profiles = [
  { id: "active", name: "Active", active: true },
  { id: "first", name: "First", active: false },
  { id: "second", name: "Second", active: false },
];
let switched;
let messages;
beforeEach(() => {
  switched = [];
  messages = [];
  useStore.setState({
    profiles, quotas: {}, busy: false, autoSwitchEnabled: true,
    autoSwitchModel: "GLM-Next", autoSwitchThresholdWan: 35,
    refreshQuota: async () => {},
    switchTo: async (id) => { switched.push(id); return true; },
    toast: (text) => messages.push(text),
  });
});

test("legacy switch and threshold settings survive, with the original model as default", () => {
  assert.equal(initial.autoSwitchEnabled, true);
  assert.equal(initial.autoSwitchThresholdWan, 42);
  assert.equal(initial.autoSwitchModel, "GLM-5.2");
});

test("new model selects the account with its highest quota, independently of old model quotas", async () => {
  useStore.setState({ quotas: {
    active: quota(balance("GLM-5.2", 2_000_000), balance("GLM-Next", 100_000)),
    first: quota(balance("GLM-5.2", 2_900_000), balance("GLM-Next", 1_000_000)),
    second: quota(balance("GLM-5.2", 0), balance("GLM-Next", 2_000_000)),
  } });
  await useStore.getState().refreshActiveQuotaForAutoSwitch();
  assert.deepEqual(switched, ["second"]);
  assert.ok(messages[0].includes("GLM-Next"));
  assert.ok(!messages[0].includes("GLM-5.2"));
});

test("missing selected model on the active account never triggers a switch", async () => {
  useStore.setState({ quotas: {
    active: quota(balance("GLM-5.2", 0)),
    first: quota(balance("GLM-Next", 2_000_000)),
  } });
  await useStore.getState().refreshActiveQuotaForAutoSwitch();
  assert.deepEqual(switched, []);
});

test("candidates without selected model data or with refresh errors are skipped", async () => {
  useStore.setState({ quotas: {
    active: quota(balance("GLM-Next", 0)),
    first: quota(balance("GLM-5.2", 3_000_000)),
    second: { ...quota(balance("GLM-Next", 2_000_000)), error: "Refresh failed" },
  } });
  await useStore.getState().refreshActiveQuotaForAutoSwitch();
  assert.deepEqual(switched, []);
});

test("threshold boundaries do not cause repeated account switches", async () => {
  useStore.setState({ quotas: {
    active: quota(balance("GLM-Next", 350_000)),
    first: quota(balance("GLM-Next", 2_000_000)),
  } });
  await useStore.getState().refreshActiveQuotaForAutoSwitch();
  assert.deepEqual(switched, []);
  useStore.setState({ quotas: {
    active: quota(balance("GLM-Next", 349_999)),
    first: quota(balance("GLM-Next", 350_000)),
  } });
  await useStore.getState().refreshActiveQuotaForAutoSwitch();
  assert.deepEqual(switched, []);
});

test("model matching ignores case and surrounding spaces, and keeps distinct models separate", () => {
  const q = quota(balance("GLM-Next-Pro", 3_000_000), balance(" GLM-Next ", 200_000));
  assert.equal(modelRemaining(q, " glm-next "), 200_000);
  assert.equal(modelRemaining(q, "GLM"), null);
  assert.equal(modelRemaining(q, ""), null);
});

test("new model and decimal threshold are persisted without the old 100-wan cap", () => {
  const state = useStore.getState();
  state.setAutoSwitchModel(" GLM-Future ");
  state.setAutoSwitchModel(" ");
  state.setAutoSwitchThresholdWan(1000.25);
  assert.equal(useStore.getState().autoSwitchModel, "GLM-Future");
  assert.equal(saved.get("zcs:autoSwitchModel"), "GLM-Future");
  assert.equal(useStore.getState().autoSwitchThresholdWan, 1000.25);
  assert.equal(saved.get("zcs:glm52AutoSwitchThresholdWan"), "1000.25");
});

test("floating statistics follow the chosen model and exclude missing model quotas", () => {
  const stats = computeModelPoolStats(profiles, {
    active: quota(balance("GLM-Next", 100_000)),
    first: quota(balance("GLM-Next", 2_000_000)),
    second: quota(balance("GLM-5.2", 0)),
  }, 35, "GLM-Next");
  assert.equal(stats.totalAccounts, 2);
  assert.equal(stats.usedAccounts, 1);
  assert.equal(stats.remainingAccounts, 1);
});
