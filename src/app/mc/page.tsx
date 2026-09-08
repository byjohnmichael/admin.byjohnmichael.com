"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

type Player = {
  uuid: string;
  name: string;
  level: number;
  hoursPlayed: number;
  deaths: number;
  banned: boolean;
  medals: number;
  honor: number;
};

type WhitelistRequest = {
  id: string;
  username: string;
  requestedAt: string;
};

type MarkerDimension = "overworld" | "nether" | "end";
type MarkerIcon = "pin" | "home" | "kingdom" | "town" | "mountain";

type Marker = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: MarkerDimension;
  icon: MarkerIcon;
  detail: string;
};

const MARKER_DIMENSIONS: { value: MarkerDimension; label: string }[] = [
  { value: "overworld", label: "Overworld" },
  { value: "nether", label: "Nether" },
  { value: "end", label: "The End" },
];

const MARKER_ICONS: { value: MarkerIcon; label: string }[] = [
  { value: "pin", label: "Default pin" },
  { value: "home", label: "Home" },
  { value: "kingdom", label: "Kingdom" },
  { value: "town", label: "Town" },
  { value: "mountain", label: "Mountain" },
];

const BLANK_MARKER_FORM = {
  name: "",
  x: "",
  y: "",
  z: "",
  dimension: "overworld" as MarkerDimension,
  icon: "pin" as MarkerIcon,
  detail: "",
};

type LocationType = "landmark" | "home" | "town" | "kingdom" | "mountain";

type LocationRequest = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  type: LocationType;
  submittedBy: string;
  requestedAt: string;
};

type LocationDraft = {
  name: string;
  detail: string;
  x: string;
  y: string;
  z: string;
  dimension: MarkerDimension;
  type: LocationType;
};

const LOCATION_TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: "landmark", label: "Landmark" },
  { value: "home", label: "Home" },
  { value: "town", label: "Town" },
  { value: "kingdom", label: "Kingdom" },
  { value: "mountain", label: "Mountain" },
];

export default function McPage() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [requests, setRequests] = useState<WhitelistRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quickAddUsername, setQuickAddUsername] = useState("");
  const [quickAddMessage, setQuickAddMessage] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [markers, setMarkers] = useState<Marker[] | null>(null);
  const [markersDirty, setMarkersDirty] = useState(false);
  const [markerForm, setMarkerForm] = useState(BLANK_MARKER_FORM);
  const [markerMessage, setMarkerMessage] = useState("");
  const [locationRequests, setLocationRequests] = useState<
    LocationRequest[] | null
  >(null);
  const [locationDrafts, setLocationDrafts] = useState<
    Record<string, LocationDraft>
  >({});
  const [locationMessage, setLocationMessage] = useState("");

  const loadPlayers = useCallback(() => {
    fetch("/api/mc/players")
      .then((r) => r.json())
      .then((data) => setPlayers(data.entries ?? []));
  }, []);

  const loadRequests = useCallback(() => {
    fetch("/api/mc/whitelist")
      .then((r) => r.json())
      .then((data) => setRequests(data.requests ?? []));
  }, []);

  const loadMarkers = useCallback(() => {
    fetch("/api/mc/markers")
      .then((r) => r.json())
      .then((data) => {
        setMarkers(data.markers ?? []);
        setMarkersDirty(Boolean(data.dirty));
      });
  }, []);

  const loadLocationRequests = useCallback(() => {
    fetch("/api/mc/location-requests")
      .then((r) => r.json())
      .then((data) => {
        const list: LocationRequest[] = data.requests ?? [];
        setLocationRequests(list);
        setLocationDrafts((prev) => {
          const next = { ...prev };
          for (const req of list) {
            if (!next[req.id]) {
              next[req.id] = {
                name: req.name,
                detail: "",
                x: String(req.x),
                y: String(req.y),
                z: String(req.z),
                dimension: "overworld",
                type: req.type,
              };
            }
          }
          return next;
        });
      });
  }, []);

  useEffect(() => {
    loadPlayers();
    loadRequests();
    loadMarkers();
    loadLocationRequests();
  }, [loadPlayers, loadRequests, loadMarkers, loadLocationRequests]);

  async function adjustMedals(username: string, delta: number) {
    setBusy(`medals:${username}`);
    await fetch("/api/mc/medals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, delta }),
    });
    loadPlayers();
    setBusy(null);
  }

  async function toggleBan(username: string, banned: boolean) {
    setBusy(`ban:${username}`);
    await fetch("/api/mc/ban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, action: banned ? "unban" : "ban" }),
    });
    loadPlayers();
    setBusy(null);
  }

  async function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const username = quickAddUsername.trim();
    if (!USERNAME_PATTERN.test(username)) {
      setQuickAddMessage("3-16 characters: letters, numbers, or underscore.");
      return;
    }

    setBusy("quickadd");
    setQuickAddMessage("");
    const response = await fetch("/api/mc/whitelist/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    if (response.ok) {
      setQuickAddMessage(`Added ${username} to the whitelist.`);
      setQuickAddUsername("");
      loadPlayers();
    } else {
      const data = await response.json().catch(() => ({}));
      setQuickAddMessage(data.error ?? "Failed to add to whitelist.");
    }
    setBusy(null);
  }

  async function resolveRequest(id: string, action: "accept" | "deny") {
    setBusy(`request:${id}`);
    setRequestMessage("");
    const response = await fetch("/api/mc/whitelist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setRequestMessage(data.error ?? "Failed to resolve request.");
    }
    loadRequests();
    setBusy(null);
  }

  async function addMarkerFromForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMarkerMessage("");
    setBusy("marker-add");
    const response = await fetch("/api/mc/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        name: markerForm.name.trim(),
        x: Number(markerForm.x),
        y: Number(markerForm.y),
        z: Number(markerForm.z),
        dimension: markerForm.dimension,
        icon: markerForm.icon,
        detail: markerForm.detail.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setMarkers(data.markers ?? []);
      setMarkersDirty(Boolean(data.dirty));
      setMarkerForm({ ...BLANK_MARKER_FORM });
    } else {
      setMarkerMessage(data.error ?? "Failed to add marker.");
    }
    setBusy(null);
  }

  async function removeMarker(id: string) {
    setBusy(`marker:${id}`);
    const response = await fetch("/api/mc/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const data = await response.json().catch(() => ({}));
    setMarkers(data.markers ?? []);
    setMarkersDirty(Boolean(data.dirty));
    setBusy(null);
  }

  async function applyMarkersToMap() {
    setMarkerMessage("");
    setBusy("marker-apply");
    const response = await fetch("/api/mc/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setMarkers(data.markers ?? []);
      setMarkersDirty(Boolean(data.dirty));
      setMarkerMessage(
        "Applied. BlueMap is reloading — markers appear in a few seconds.",
      );
    } else {
      setMarkerMessage(data.error ?? "Failed to apply markers.");
    }
    setBusy(null);
  }

  function updateLocationDraft(id: string, patch: Partial<LocationDraft>) {
    setLocationDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function denyLocation(id: string) {
    setBusy(`loc:${id}`);
    const response = await fetch("/api/mc/location-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deny", id }),
    });
    const data = await response.json().catch(() => ({}));
    setLocationRequests(data.requests ?? []);
    setBusy(null);
  }

  async function acceptLocation(id: string) {
    const draft = locationDrafts[id];
    if (!draft) return;
    setLocationMessage("");
    setBusy(`loc:${id}`);
    const response = await fetch("/api/mc/location-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "accept",
        id,
        name: draft.name.trim(),
        detail: draft.detail.trim(),
        x: Number(draft.x),
        y: Number(draft.y),
        z: Number(draft.z),
        dimension: draft.dimension,
        type: draft.type,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setLocationRequests(data.requests ?? []);
      if (data.markers) setMarkers(data.markers);
      setMarkersDirty(Boolean(data.dirty));
      setLocationMessage(
        'Approved and added to markers — hit "Apply to map" below to publish it.',
      );
    } else {
      setLocationMessage(data.error ?? "Failed to approve request.");
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="panel overflow-x-auto p-6">
        <h2 className="mb-4 text-base font-semibold">Players</h2>
        {players === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : players.length === 0 ? (
          <p className="text-sm text-ink-dim">No one has played yet.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-panel-border text-ink-dim">
                <th className="py-2 pr-4 font-medium">Username</th>
                <th className="py-2 pr-4 font-medium">Level</th>
                <th className="py-2 pr-4 font-medium">Time played</th>
                <th className="py-2 pr-4 font-medium">Deaths</th>
                <th className="py-2 pr-4 font-medium">Medals</th>
                <th className="py-2 pr-4 font-medium">Honor</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.uuid} className="border-b border-panel-border/60">
                  <td className="py-3 pr-4">{player.name}</td>
                  <td className="py-3 pr-4 tabular-nums">{player.level}</td>
                  <td className="py-3 pr-4 tabular-nums">
                    {player.hoursPlayed.toFixed(1)} h
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{player.deaths}</td>
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-ghost px-2 py-1"
                        disabled={busy === `medals:${player.name}`}
                        onClick={() => adjustMedals(player.name, -1)}
                      >
                        −
                      </button>
                      <span className="w-6 text-center tabular-nums">
                        {player.medals}
                      </span>
                      <button
                        className="btn btn-ghost px-2 py-1"
                        disabled={busy === `medals:${player.name}`}
                        onClick={() => adjustMedals(player.name, 1)}
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="py-3 pr-4 tabular-nums font-semibold text-accent">
                    {player.honor.toFixed(1)}
                  </td>
                  <td className="py-3 pr-4">
                    <button
                      className={`btn ${player.banned ? "btn-accent" : "btn-danger"}`}
                      disabled={busy === `ban:${player.name}`}
                      onClick={() => toggleBan(player.name, player.banned)}
                    >
                      {player.banned ? "Unban" : "Ban"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel p-6">
        <h2 className="mb-4 text-base font-semibold">Whitelist requests</h2>

        <form
          onSubmit={handleQuickAdd}
          className="mb-6 flex items-end gap-3 border-b border-panel-border/60 pb-6"
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-ink-dim">Quick add</span>
            <input
              value={quickAddUsername}
              onChange={(event) => setQuickAddUsername(event.target.value)}
              placeholder="Username"
              minLength={3}
              maxLength={16}
              className="input"
            />
          </label>
          <button
            type="submit"
            disabled={busy === "quickadd"}
            className="btn btn-accent"
          >
            {busy === "quickadd" ? "Adding..." : "Add to whitelist"}
          </button>
          {quickAddMessage && (
            <p className="text-xs text-ink-dim">{quickAddMessage}</p>
          )}
        </form>

        {requestMessage && (
          <p className="mb-4 text-xs text-danger">{requestMessage}</p>
        )}

        {requests === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-ink-dim">No pending requests.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between border-b border-panel-border/60 pb-3 last:border-b-0"
              >
                <div>
                  <p className="text-sm">{request.username}</p>
                  <p className="text-xs text-ink-dim">
                    requested {new Date(request.requestedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-accent"
                    disabled={busy === `request:${request.id}`}
                    onClick={() => resolveRequest(request.id, "accept")}
                  >
                    Accept
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busy === `request:${request.id}`}
                    onClick={() => resolveRequest(request.id, "deny")}
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-6">
        <h2 className="mb-1 text-base font-semibold">Location requests</h2>
        <p className="mb-4 text-xs text-ink-dim">
          Player-submitted map names. Edit anything, then Accept to add it to the
          markers below (you still need to press &ldquo;Apply to map&rdquo;), or
          Deny to discard it.
        </p>
        {locationMessage && (
          <p className="mb-4 text-xs text-ink-dim">{locationMessage}</p>
        )}
        {locationRequests === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : locationRequests.length === 0 ? (
          <p className="text-sm text-ink-dim">No pending location requests.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {locationRequests.map((req) => {
              const draft = locationDrafts[req.id];
              if (!draft) return null;
              return (
                <li
                  key={req.id}
                  className="rounded-lg border border-panel-border/60 p-4"
                >
                  <p className="mb-3 text-xs text-ink-dim">
                    from {req.submittedBy || "anonymous"} ·{" "}
                    {new Date(req.requestedAt).toLocaleString()}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-xs text-ink-dim">Name</span>
                      <input
                        value={draft.name}
                        onChange={(e) =>
                          updateLocationDraft(req.id, { name: e.target.value })
                        }
                        maxLength={48}
                        className="input"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-ink-dim">Type</span>
                      <select
                        value={draft.type}
                        onChange={(e) =>
                          updateLocationDraft(req.id, {
                            type: e.target.value as LocationType,
                          })
                        }
                        className="input"
                      >
                        {LOCATION_TYPE_OPTIONS.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-ink-dim">Dimension</span>
                      <select
                        value={draft.dimension}
                        onChange={(e) =>
                          updateLocationDraft(req.id, {
                            dimension: e.target.value as MarkerDimension,
                          })
                        }
                        className="input"
                      >
                        {MARKER_DIMENSIONS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-ink-dim">X</span>
                      <input
                        type="number"
                        value={draft.x}
                        onChange={(e) =>
                          updateLocationDraft(req.id, { x: e.target.value })
                        }
                        className="input"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-ink-dim">Y</span>
                      <input
                        type="number"
                        value={draft.y}
                        onChange={(e) =>
                          updateLocationDraft(req.id, { y: e.target.value })
                        }
                        className="input"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-ink-dim">Z</span>
                      <input
                        type="number"
                        value={draft.z}
                        onChange={(e) =>
                          updateLocationDraft(req.id, { z: e.target.value })
                        }
                        className="input"
                      />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                      <span className="text-xs text-ink-dim">
                        Detail (optional)
                      </span>
                      <input
                        value={draft.detail}
                        onChange={(e) =>
                          updateLocationDraft(req.id, { detail: e.target.value })
                        }
                        maxLength={200}
                        className="input"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn btn-accent"
                      disabled={busy === `loc:${req.id}`}
                      onClick={() => acceptLocation(req.id)}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-danger"
                      disabled={busy === `loc:${req.id}`}
                      onClick={() => denyLocation(req.id)}
                    >
                      Deny
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            BlueMap markers
            {markersDirty && (
              <span className="ml-2 rounded bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
                unapplied changes
              </span>
            )}
          </h2>
          <button
            className="btn btn-accent"
            disabled={!markersDirty || busy === "marker-apply"}
            onClick={applyMarkersToMap}
          >
            {busy === "marker-apply" ? "Applying..." : "Apply to map"}
          </button>
        </div>

        <form
          onSubmit={addMarkerFromForm}
          className="mb-6 grid gap-3 border-b border-panel-border/60 pb-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-ink-dim">Name</span>
            <input
              value={markerForm.name}
              onChange={(e) =>
                setMarkerForm({ ...markerForm, name: e.target.value })
              }
              maxLength={48}
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-dim">Dimension</span>
            <select
              value={markerForm.dimension}
              onChange={(e) =>
                setMarkerForm({
                  ...markerForm,
                  dimension: e.target.value as MarkerDimension,
                })
              }
              className="input"
            >
              {MARKER_DIMENSIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-dim">Icon</span>
            <select
              value={markerForm.icon}
              onChange={(e) =>
                setMarkerForm({
                  ...markerForm,
                  icon: e.target.value as MarkerIcon,
                })
              }
              className="input"
            >
              {MARKER_ICONS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-dim">X</span>
            <input
              type="number"
              value={markerForm.x}
              onChange={(e) =>
                setMarkerForm({ ...markerForm, x: e.target.value })
              }
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-dim">Y</span>
            <input
              type="number"
              value={markerForm.y}
              onChange={(e) =>
                setMarkerForm({ ...markerForm, y: e.target.value })
              }
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-dim">Z</span>
            <input
              type="number"
              value={markerForm.z}
              onChange={(e) =>
                setMarkerForm({ ...markerForm, z: e.target.value })
              }
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-ink-dim">Detail (optional)</span>
            <input
              value={markerForm.detail}
              onChange={(e) =>
                setMarkerForm({ ...markerForm, detail: e.target.value })
              }
              maxLength={200}
              className="input"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <button
              type="submit"
              disabled={busy === "marker-add"}
              className="btn btn-accent"
            >
              {busy === "marker-add" ? "Adding..." : "Add marker"}
            </button>
            {markerMessage && (
              <p className="text-xs text-ink-dim">{markerMessage}</p>
            )}
          </div>
        </form>

        {markers === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : markers.length === 0 ? (
          <p className="text-sm text-ink-dim">No markers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-panel-border text-ink-dim">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Position</th>
                  <th className="py-2 pr-4 font-medium">Dimension</th>
                  <th className="py-2 pr-4 font-medium">Icon</th>
                  <th className="py-2 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {markers.map((marker) => (
                  <tr
                    key={marker.id}
                    className="border-b border-panel-border/60"
                  >
                    <td className="py-3 pr-4">
                      {marker.name}
                      {marker.detail && (
                        <span className="block text-xs text-ink-dim">
                          {marker.detail}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {marker.x}, {marker.y}, {marker.z}
                    </td>
                    <td className="py-3 pr-4 capitalize">{marker.dimension}</td>
                    <td className="py-3 pr-4 capitalize">{marker.icon}</td>
                    <td className="py-3 pr-4">
                      <button
                        className="btn btn-danger"
                        disabled={busy === `marker:${marker.id}`}
                        onClick={() => removeMarker(marker.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
