// scripts/vault-app.js
// ApplicationV2 UI for browsing the player's Hero Vault characters
// and yeeting the current actor into the cloud.

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { RavnVaultClient } from "./vault-client.js";

const MODULE_ID = "ravn-realmsync";

class RavnVaultAppBase extends HandlebarsApplicationMixin(ApplicationV2) { }

export class RavnVaultApp extends RavnVaultAppBase {
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: "ravn-realmsync-vault",
    tag: "section",
    window: {
      title: "R.A.V.N. — Hero Vault",
      icon: "fa-solid fa-crow"
    },
    classes: ["ravn-realmsync", "sheet"],
    position: {
      width: 640,
      height: "auto"
    },
    dragDrop: [],
    actions: {},
    template: "modules/ravn-realmsync/templates/vault-app.hbs"
  });

  /**
   * @param {{ actorId?: string|null, client?: RavnVaultClient }} options
   */
  constructor(options = {}) {
    super(options);
    this._client = options.client ?? new RavnVaultClient({
      getToken: () => game.settings.get(MODULE_ID, "playerApiToken")?.trim() || "",
      getBaseUrl: () => game.settings.get(MODULE_ID, "apiBaseUrl")?.trim() || "https://hero-vault.ravn-quest.online"
    });
  }


  /**
   * Tiny UI state container because ApplicationV2.state is reserved for lifecycle.
   */
  get uiState() {
    if (!this._uiState) this._uiState = this._defineState();
    return this._uiState;
  }

  async update(changes = {}) {
    this._uiState = { ...(this._uiState ?? this._defineState()), ...(changes ?? {}) };
    await this.render(true);
    return this;
  }

  _defineState() {
    const actorId = this.options.actorId ?? null;
    const actor = actorId ? game.actors?.get(actorId) ?? null : null;

    return {
      loading: false,
      error: null,
      actorId,
      actorName: actor?.name ?? null,
      systemId: game.system?.id ?? "unknown-system",
      characters: [],
      selectedId: null,
      lastRefreshedAt: null
    };
  }

  async _prepareContext() {
    const token = game.settings.get(MODULE_ID, "playerApiToken")?.trim() || "";

    return {
      ...this.uiState,
      hasToken: Boolean(token),
      apiBaseUrl: game.settings.get(MODULE_ID, "apiBaseUrl")?.trim() || "https://hero-vault.ravn-quest.online",
      userName: game.user?.name ?? "Mysterious Entity"
    };
  }

  async _onFirstRender(context, parts, options) {
    // HandlebarsApplicationMixin gives us a parts map. For a single-template app
    // this is usually { body: HTMLElement }, but we defensively grab "whatever".
    const root =
      parts?.body ??
      parts?.element ??
      (parts && Object.values(parts)[0]) ??
      null;

    if (!root) {
      console.warn("RavnVaultApp _onFirstRender: no root element found in parts", parts);
      return;
    }

    // One delegated listener so we don't duplicate handlers every render.
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (!action) return;

      switch (action) {
        case "refresh-remote":
          this.#handleRefreshRemote();
          break;
        case "select-remote": {
          const id = button.dataset.id || null;
          this.#handleSelectRemote(id);
          break;
        }
        case "import-remote": {
          const id = button.dataset.id || this.uiState.selectedId;
          this.#handleImportRemote(id);
          break;
        }
        case "export-current":
          this.#handleExportCurrent();
          break;
      }
    });

    // Kick off initial load if we have a token.
    if (context.hasToken) {
      this.#handleRefreshRemote();
    }
  }


  async #handleRefreshRemote() {
    try {
      await this.update({ loading: true, error: null });
      const system = this.uiState.systemId || "";
      const characters = await this._client.listCharacters({
        system,
        sort: "updated"
      });
      await this.update({
        loading: false,
        error: null,
        characters,
        lastRefreshedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error(err);
      await this.update({
        loading: false,
        error: err?.message || String(err)
      });
    }
  }

  async #handleSelectRemote(id) {
    await this.update({ selectedId: id || null });
  }

  async #handleImportRemote(id) {
    if (!id) {
      ui.notifications.warn("Select a Hero Vault character to import first.");
      return;
    }

    try {
      await this.update({ loading: true, error: null });
      const remote = await this._client.getCharacter(id);

      if (!remote?.data) {
        throw new Error("Remote character has no data payload.");
      }

      // Create a new Actor from the payload. We always import as a new actor;
      // overwriting by id is left for a future 'are you very sure?' workflow.
      const created = await Actor.create(remote.data, { renderSheet: true });
      await this.update({ loading: false, error: null });
      ui.notifications.info(`Imported "${created.name}" from Hero Vault.`);
    } catch (err) {
      console.error(err);
      await this.update({
        loading: false,
        error: err?.message || String(err)
      });
      ui.notifications.error(`Hero Vault import failed: ${err?.message || err}`);
    }
  }

  async #handleExportCurrent() {
    const actorId = this.uiState.actorId;
    const actor = actorId ? game.actors?.get(actorId) ?? null : null;

    if (!actor) {
      ui.notifications.warn("No actor bound to this R.A.V.N. panel. Open it from an actor's context menu.");
      return;
    }

    try {
      await this.update({ loading: true, error: null });
      const label = game.world?.id ?? "foundry-world";
      const result = await this._client.uploadActor(actor, { label, overwrite: true });
      await this.update({ loading: false, error: null });
      const id = result?.id || result?.vaultId || "unknown-id";
      ui.notifications.info(`Sent "${actor.name}" to Hero Vault (id=${id}).`);
    } catch (err) {
      console.error(err);
      await this.update({
        loading: false,
        error: err?.message || String(err)
      });
      ui.notifications.error(`Hero Vault export failed: ${err?.message || err}`);
    }
  }
}
