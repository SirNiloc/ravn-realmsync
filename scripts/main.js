// scripts/main.js
// Entry point for the R.A.V.N. — Realmsync Adventurer Vault Nexus module.
// Registers settings, wires the Actor Directory context menu, and exposes a
// macro-friendly API on game.ravnRealmsync.

import { RavnVaultApp } from "./vault-app.js";
import { RavnVaultClient } from "./vault-client.js";

const MODULE_ID = "ravn-realmsync";

function getPlayerToken() {
  return game.settings.get(MODULE_ID, "playerApiToken")?.trim() || "";
}

function getApiBaseUrl() {
  const raw = game.settings.get(MODULE_ID, "apiBaseUrl")?.trim() || "";
  return (raw || "https://hero-vault.ravn-quest.online").replace(/\/$/, "");
}

// Lazy singleton client so macros and UI share it.
function getVaultClient() {
  const existing = game.ravnRealmsync?.client;
  if (existing) return existing;

  const client = new RavnVaultClient({
    getToken: getPlayerToken,
    getBaseUrl: getApiBaseUrl
  });

  if (!game.ravnRealmsync) game.ravnRealmsync = {};
  game.ravnRealmsync.client = client;
  return client;
}

Hooks.once("init", () => {
  console.info(`R.A.V.N. — Realmsync Adventurer Vault Nexus | Initializing (${MODULE_ID})`);

  // Client-scope: each Foundry user supplies their own Hero Vault token.
  game.settings.register(MODULE_ID, "playerApiToken", {
    name: "Hero Vault API Token",
    hint: "Paste your personal Hero Vault API token here. Each user gets their own token.",
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  // World-scope: base URL, so you can point at staging/dev if needed.
  game.settings.register(MODULE_ID, "apiBaseUrl", {
    name: "Hero Vault API Base URL",
    hint: "Base URL for the Hero Vault service. You probably want the default.",
    scope: "world",
    config: true,
    type: String,
    default: "https://hero-vault.ravn-quest.online"
  });

  // Tiny equality helper for the template.
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
});

Hooks.once("ready", () => {
  console.info(
    "R.A.V.N. — Realmsync Adventurer Vault Nexus is ready. Right-click an owned actor → Send to R.A.V.N. Vault…"
  );

  const client = getVaultClient();

  // Public API for macros and other modules.
  const api = {
    ...(game.ravnRealmsync ?? {}),
    MODULE_ID,
    client,

    /**
     * Export a Foundry Actor document directly.
     * @param {Actor|string} actorOrId
     * @param {{ label?: string, overwrite?: boolean }} [options]
     */
    async exportActor(actorOrId, { label, overwrite = true } = {}) {
      let actor = actorOrId;
      if (typeof actorOrId === "string") {
        actor = game.actors?.get(actorOrId) ?? null;
      }
      if (!(actor instanceof Actor)) {
        throw new Error("exportActor expected an Actor or actor id.");
      }

      const worldLabel = label ?? game.world?.id ?? "foundry-world";
      return client.uploadActor(actor, { label: worldLabel, overwrite });
    },

    /**
     * Export an actor by UUID for macro use.
     * Example UUID: "Actor.abc123" or "Scene.xyz.Token.def.Actor.abc123"
     *
     * @param {string} uuid
     * @param {{ label?: string, overwrite?: boolean }} [options]
     */
    async exportActorByUuid(uuid, { label, overwrite = true } = {}) {
      if (!uuid) {
        throw new Error("exportActorByUuid requires a UUID.");
      }

      const doc = await fromUuid(uuid);
      if (!(doc instanceof Actor)) {
        throw new Error(`UUID does not resolve to an Actor: ${uuid}`);
      }

      const worldLabel = label ?? game.world?.id ?? "foundry-world";
      return client.uploadActor(doc, { label: worldLabel, overwrite });
    },

    /**
     * Open the Hero Vault browser panel.
     * @param {Actor|string|null} [actorOrId]  Optional actor or id to bind.
     */
    openVaultBrowserForActor(actorOrId = null) {
      let actor = actorOrId;
      if (typeof actorOrId === "string") {
        actor = game.actors?.get(actorOrId) ?? null;
      }
      const app = new RavnVaultApp({
        actorId: actor?.id ?? null,
        client
      });
      app.render(true);
      return app;
    }
  };

  game.ravnRealmsync = api;

  // Also expose the same API on the module object for mod.api access.
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = api;

  /**
   * Actor Directory context menu entry.
   */
  Hooks.on("getActorDirectoryEntryContext", (directory, entries) => {
    if (!Array.isArray(entries)) return;

    entries.push({
      name: "Send to R.A.V.N. Vault…",
      icon: "fa-solid fa-crow",
      condition: (li) => {
        if (!(li instanceof HTMLElement)) return false;
        const id = li.dataset.documentId || li.dataset.actorId;
        if (!id) return false;

        const actor = game.actors?.get(id);
        if (!actor) return false;

        const type = actor.type ?? actor.system?.type;
        const isCharacterLike = type === "character" || type === "pc" || type === "hero";
        const isOwner = actor.isOwner || game.user?.isGM;

        return Boolean(isCharacterLike && isOwner);
      },
      callback: (li) => {
        if (!(li instanceof HTMLElement)) return;
        const id = li.dataset.documentId || li.dataset.actorId;
        const actor = id ? game.actors?.get(id) ?? null : null;

        if (!actor) {
          ui.notifications.warn("Could not resolve actor for R.A.V.N. Vault export.");
          return;
        }

        const app = new RavnVaultApp({ actorId: actor.id, client });
        app.render(true);
      }
    });
  });
});
