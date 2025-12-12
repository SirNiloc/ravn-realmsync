# R.A.V.N. — Realmsync Adventurer Vault Nexus

![Downloads (Latest) – ravn-realmsync](https://img.shields.io/badge/dynamic/json?label=Downloads%20(Latest-Release)&query=assets%5B1%5D.download_count&url=https%3A%2F%2Fapi.github.com%2Frepos%2FSirNiloc%2Fravn-realmsync%2Freleases%2Flatest) [![discord members](https://discord-live-members-count-badge.vercel.app/api/discord-members?guildId=695448793469943819)](https://discord.gg/kNadwUqqjQ)

Authentication is provided via Patreon accounts, with no payment or subscription required to access the site.

**Warning**: R.A.V.N. is currently in active development. Features, APIs, and behaviors may change without notice, and temporary server downtime is expected during updates. While data loss is unlikely, it is still possible—always keep local backups of your characters to ensure nothing is lost.

**West Marches Usage**: R.A.V.N. is my little side project for Westmarches/Sandbox-style campaigns, where players move between multiple parties, sessions, and worlds. The system provides a path for transferring characters across servers and preserving identity and progression. (A select few GMs have additional tools for tracking updates, continuity, reports, and cross-session consistency - feature not currently live, still in closed testing - direct any questions to me (SirNiloc) or Scop3Cr33p)

Cloud-connected character import/export for Foundry VTT.

R.A.V.N. links your Foundry world to the Hero Vault service so you can safely save characters to a personal cloud vault and pull them back into any server later. Use it as a reliable import/export path instead of juggling JSON files.

---

## Features

- Save any actor you own to your Hero Vault
- Import vaulted characters into the current world as new actors or overwrite existing ones
- Per-system filtering so you only see characters for the active game system
- Dialog-driven workflow with clear warnings and status notifications

---

## Installation

1. Install the module via Foundry's **Add-on Modules** UI.
2. Enable **R.A.V.N. – Realmsync Adventurer Vault Nexus** in your world.
3. Configure your Hero Vault connection in the module settings (API URL and token, if required).

---

## Macro: Import/Export Hero Wrangler

Create a new **Script Macro** in Foundry, name it something like `R.A.V.N. Import/Export Hero Wrangler™`, and paste the following code:

```js
// R.A.V.N. Macro: "Import/Export Hero Wrangler™"

(async () => {
  const MODULE_ID = "ravn-realmsync";

  const mod = game.modules.get(MODULE_ID);
  const api = mod?.api ?? game.ravnRealmsync;
  const client = api?.client;

  if (!api || !client || typeof api.exportActorByUuid !== "function") {
    ui.notifications.error("R.A.V.N. Realmsync API not available.");
    console.error("Missing API:", { api, client });
    return;
  }

  const esc = foundry.utils.escapeHTML;
  const systemId = game.system.id;

  async function fetchVaultCharacters() {
    try {
      if (typeof client.listCharacters !== "function") {
        console.warn("R.A.V.N. Realmsync client.listCharacters not found; returning empty list.");
        return [];
      }
      const list = await client.listCharacters({ system: systemId, sort: "updated" });
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.error("Error fetching vaulted characters:", err);
      ui.notifications.error("Failed to fetch Hero Vault characters.");
      return [];
    }
  }

  // Given a base label, actor name, and system, ensure a unique label
  // by appending " (2)", " (3)", etc. if needed.
  function makeUniqueLabel(baseLabel, actorName, systemId, remoteChars) {
    // Filter to characters that are "the same hero family" (same system + name)
    const sameName = remoteChars.filter(
      (c) => c.system === systemId && c.name === actorName
    );
    const existingLabels = new Set(
      sameName
        .map((c) => c.label || "")
        .filter((lbl) => typeof lbl === "string" && lbl.length)
    );

    if (!existingLabels.has(baseLabel)) return baseLabel;

    let i = 2;
    while (existingLabels.has(`${baseLabel} (${i})`)) i++;
    return `${baseLabel} (${i})`;
  }

  // ---------------------------------------------------------------------------
  // Step 0: choose mode
  // ---------------------------------------------------------------------------
  const mode = await new Promise((resolve) => {
    new Dialog({
      title: "R.A.V.N. Hero Vault",
      content: `<p>What do you want to do?</p>`,
      buttons: {
        export: {
          label: "Export to Hero Vault",
          callback: () => resolve("export")
        },
        import: {
          label: "Import from Hero Vault",
          callback: () => resolve("import")
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "export"
    }).render(true);
  });

  if (!mode) return;

 // ---------------------------------------------------------------------------
// IMPORT MODE (NO OVERWRITE OPTION — ALWAYS CREATES NEW ACTOR)
// ---------------------------------------------------------------------------
if (mode === "import") {
  const remoteChars = await fetchVaultCharacters();

  const sameSystemChars = remoteChars.filter((c) => c.system === systemId);
  if (!sameSystemChars.length) {
    ui.notifications.warn(
      `You have no Hero Vault characters for system "${systemId}" to import.`
    );
    return;
  }

  // Step 1: choose remote hero
  const remoteOptionsHtml = sameSystemChars
    .map((c) => {
      const labelParts = [
        c.name || "Unnamed",
        c.system ? `[${c.system}]` : "",
        c.label ? `(${c.label})` : ""
      ].filter(Boolean);
      return `<option value="${esc(c.id)}">${esc(labelParts.join(" "))}</option>`;
    })
    .join("");

  const importHeroContent = `
    <form>
      <div class="form-group">
        <label>Select Hero to Import (system: ${esc(systemId)})</label>
        <select name="remoteId" style="width:100%">
          ${remoteOptionsHtml}
        </select>
      </div>
      <p>Import will ALWAYS create a new actor. Overwrite disabled.</p>
    </form>
  `;

  const remoteId = await new Promise((resolve) => {
    new Dialog({
      title: "Import from Hero Vault",
      content: importHeroContent,
      buttons: {
        ok: {
          label: "Import",
          default: true,
          callback: (html) => {
            const root = html[0] ?? html;
            const select = root.querySelector("select[name='remoteId']");
            resolve(select?.value ?? null);
          }
        },
        cancel: { label: "Cancel", callback: () => resolve(null) }
      },
      default: "ok"
    }).render(true);
  });

  if (!remoteId) {
    ui.notifications.info("Import canceled.");
    return;
  }

  try {
    // Always create a NEW ACTOR
    const resultActor = await api.importActorById(remoteId, {
      targetActorUuid: null,
      renderSheet: true
    });

    ui.notifications.info(
      `Imported “${esc(resultActor.name)}” as a NEW actor.`
    );
  } catch (err) {
    console.error("Import failed:", err);
    ui.notifications.error(`Import failed: ${err?.message || err}`);
  }

  return;
}

  // ---------------------------------------------------------------------------
  // EXPORT MODE
  // ---------------------------------------------------------------------------

  const exportableActors = game.actors.contents.filter((a) => a.isOwner);
  if (!exportableActors.length) {
    ui.notifications.warn("You have no actors you can export.");
    return;
  }

  const actorOptionsHtml = exportableActors
    .map((actor) => {
      const label = `${actor.name} [${actor.type}]`;
      return `<option value="${actor.uuid}">${esc(label)}</option>`;
    })
    .join("");

  const actorDialogContent = `
    <form>
      <div class="form-group">
        <label>Select actor to export</label>
        <select name="actorUuid" style="width:100%">
          ${actorOptionsHtml}
        </select>
      </div>
    </form>
  `;

  const actorUuid = await new Promise((resolve) => {
    new Dialog({
      title: "Export Actor to R.A.V.N. Hero Vault",
      content: actorDialogContent,
      buttons: {
        export: {
          label: "Continue",
          default: true,
          callback: (html) => {
            const root = html[0] ?? html;
            const select = root.querySelector("select[name='actorUuid']");
            resolve(select?.value ?? null);
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "export"
    }).render(true);
  });

  if (!actorUuid) return;

  const actor = fromUuidSync(actorUuid);
  if (!actor) {
    ui.notifications.error("Could not resolve actor from UUID.");
    return;
  }

  const worldId = game.world?.id ?? "unknown-world";
  const defaultNewLabel = `${worldId}:${actor.name}`;

  const remoteChars = await fetchVaultCharacters();
  const heroLimit = Number.isFinite(client?.heroLimit) ? Number(client.heroLimit) : Infinity;
  const usedHeroes = Array.isArray(remoteChars) ? remoteChars.length : 0;
  const hasOpenSlot = usedHeroes < heroLimit;

  const remoteOptions = [];
  if (hasOpenSlot || !Number.isFinite(heroLimit)) {
    remoteOptions.push(`<option value="__new__">&lt;New Character&gt;</option>`);
  }

  for (const c of remoteChars) {
    const parts = [
      c.name || "Unnamed",
      c.system ? `[${c.system}]` : "",
      c.label ? `(${c.label})` : ""
    ].filter(Boolean);
    remoteOptions.push(
      `<option value="${esc(c.id)}">${esc(parts.join(" "))}</option>`
    );
  }

  const exportModeContent = `
    <form>
      <div class="form-group">
        <p>Exporting: <strong>${esc(actor.name)}</strong></p>
      </div>

      <div class="form-group">
        <label>Vault Target</label>
        <select name="targetId" style="width:100%">
          ${remoteOptions.join("")}
        </select>
        <small>
          Select an existing hero to overwrite, or choose &lt;New Character&gt; to create a new hero.
        </small>
      </div>

      <div class="form-group">
        <label>New Character Label</label>
        <input type="text" name="newLabel" value="${esc(defaultNewLabel)}" style="width:100%" />
        <small>Used when creating a new hero in the vault.</small>
      </div>
    </form>
  `;

  const exportChoice = await new Promise((resolve) => {
    new Dialog({
      title: "Export to Hero Vault",
      content: exportModeContent,
      buttons: {
        ok: {
          label: "Export",
          default: true,
          callback: (html) => {
            const root = html[0] ?? html;
            const select = root.querySelector("select[name='targetId']");
            const input = root.querySelector("input[name='newLabel']");
            resolve({
              targetId: select?.value ?? "__new__",
              newLabel: input?.value?.trim() || defaultNewLabel
            });
          }
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null)
        }
      },
      default: "ok"
    }).render(true);
  });

  if (!exportChoice) {
    ui.notifications.info("Export canceled.");
    return;
  }

  const { targetId, newLabel } = exportChoice;

  let overwrite = false;
  let label;

  if (targetId === "__new__") {
    // Force a *unique* label so the server treats this as a truly new hero,
    // even if you've exported "the same" actor before.
    overwrite = false;
    label = makeUniqueLabel(newLabel, actor.name, systemId, remoteChars);
  } else {
    const existing = remoteChars.find((c) => String(c.id) === String(targetId));
    overwrite = true;
    label = existing?.label || existing?.name || worldId;
  }

  try {
    await api.exportActorByUuid(actorUuid, { label, overwrite });
    ui.notifications.info(
      `Exported “${actor.name}” to Hero Vault as ${
        overwrite ? "an overwrite" : "a new hero"
      } (${label}).`
    );
  } catch (err) {
    console.error("Export failed:", err);
    const msg = String(err?.message ?? err ?? "");
    if (msg.includes("413") && msg.includes("maximum number of heroes")) {
      ui.notifications.error(
        "Export failed: your Hero Vault is full. Delete a hero, then try again."
      );
    } else if (msg.includes("409") || msg.includes("Character already exists")) {
      ui.notifications.error(
        "Export failed: a hero with this name/label already exists even after trying to create a new one."
      );
    } else {
      ui.notifications.error(`Export failed: ${msg}`);
    }
  }
})();