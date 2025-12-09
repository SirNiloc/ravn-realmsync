// scripts/vault-client.js
// Minimal Hero Vault REST client.
// If the API ever changes, blame future-you. Present-you did their best.

const DEFAULT_BASE_URL = "https://hero-vault.ravn-quest.online";

export class RavnVaultClient {
  /**
   * @param {{ getToken: () => string, getBaseUrl?: () => string }} options
   */
  constructor(options = {}) {
    this._getToken = options.getToken ?? (() => "");
    this._getBaseUrl = options.getBaseUrl ?? (() => DEFAULT_BASE_URL);
  }

  get baseUrl() {
    const raw = (this._getBaseUrl?.() || DEFAULT_BASE_URL).replace(/\/$/, "");
    return raw || DEFAULT_BASE_URL;
  }

  get token() {
    return this._getToken?.() || "";
  }

  _buildHeaders() {
    const headers = {
      "Content-Type": "application/json"
    };
    const token = this.token;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  async _request(path, { method = "GET", body = undefined } = {}) {
    const url = `${this.baseUrl}${path}`;
    const options = {
      method,
      headers: this._buildHeaders()
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      // Yes, we log. No, we don't apologize.
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Hero Vault API ${response.status} ${response.statusText}: ${text}`);
    }

    // Some endpoints may be empty (204), so keep it chill.
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.includes("application/json")) return {};
    return await response.json();
  }

  /**
   * List characters for the current user.
   * Expected to return an array of:
   * { id, name, system, label, updatedAt, ... }.
   */
  async listCharacters({ system = "", sort = "updated" } = {}) {
    const params = new URLSearchParams();
    if (system) params.set("system", system);
    if (sort) params.set("sort", sort);

    const query = params.toString();
    const data = await this._request(`/api/characters${query ? `?${query}` : ""}`);

    // Try to normalize a few plausible API shapes into what the UI wants.
    const list = Array.isArray(data) ? data
      : Array.isArray(data?.characters) ? data.characters
        : Array.isArray(data?.results) ? data.results
          : [];

    return list.map((c) => ({
      id: c.id ?? c._id ?? c.characterId ?? "unknown-id",
      name: c.name ?? c.label ?? "Unnamed Hero",
      system: c.system ?? c.systemId ?? ((system || game.system?.id) ?? "unknown-system"),
      label: c.label ?? c.world ?? c.campaign ?? "",
      updatedAt: c.updatedAt ?? c.updated_at ?? c.modifiedAt ?? c.createdAt ?? ""
    }));
  }

  /**
   * Fetch a single character's payload.
   * Expected to return { id, data, ... } where `data` is a Foundry Actor JSON.
   */
  async getCharacter(id) {
    if (!id) throw new Error("getCharacter requires an id, preferably not 'potato'.");
    return await this._request(`/api/characters/${encodeURIComponent(id)}`);
  }

  /**
   * Upload an actor to the vault.
   * @param {Actor} actor
   * @param {{ label?: string, overwrite?: boolean }} options
   */
  async uploadActor(actor, { label = "", overwrite = true } = {}) {
    if (!actor) throw new Error("uploadActor requires an Actor. You passed in vibes.");
    const payload = actor.toObject();

    const body = {
      name: actor.name,
      system: actor.system?.id ?? game.system?.id ?? "unknown-system",
      label,
      overwrite,
      data: payload
    };

    return await this._request("/api/characters", {
      method: "POST",
      body
    });
  }
}
