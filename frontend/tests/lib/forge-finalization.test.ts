import { test } from "node:test";
import { strict as assert } from "node:assert";

const persona = await import("../../src/lib/persona");

test("forge finalization: composes the entered identity into Hermes SOUL.md", () => {
  const soul = persona.composeForgePersona({
    name: " Ember ",
    mission: " Keep the community informed. ",
    personality: " Calm, direct, and curious. ",
  });

  assert.equal(
    soul,
    [
      "# Hermes Agent Persona",
      "",
      "## Identity",
      "",
      "You are Ember, a FuelBorn autonomous agent.",
      "",
      "## Mission",
      "",
      "Keep the community informed.",
      "",
      "## Personality",
      "",
      "Calm, direct, and curious.",
      "",
    ].join("\n"),
  );
});
