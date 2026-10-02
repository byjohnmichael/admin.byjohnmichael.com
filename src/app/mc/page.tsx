"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

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
type MarkerIcon =
  | "pin"
  | "home"
  | "kingdom"
  | "town"
  | "mountain"
  | "landmark"
  | "river"
  | "sea"
  | "ruins"
  | "jungle";

type Marker = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  dimension: MarkerDimension;
  icon: MarkerIcon;
};

type MarkerDraft = {
  name: string;
  x: string;
  y: string;
  z: string;
  dimension: MarkerDimension;
  icon: MarkerIcon;
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
  { value: "landmark", label: "Landmark" },
  { value: "river", label: "River" },
  { value: "sea", label: "Sea" },
  { value: "ruins", label: "Ruins" },
  { value: "jungle", label: "Jungle" },
];

const BLANK_MARKER_FORM = {
  name: "",
  x: "",
  y: "",
  z: "",
  dimension: "overworld" as MarkerDimension,
  icon: "pin" as MarkerIcon,
};

type LocationType =
  | "landmark"
  | "home"
  | "town"
  | "kingdom"
  | "mountain"
  | "river"
  | "sea"
  | "ruins";

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
  { value: "river", label: "River" },
  { value: "sea", label: "Sea" },
  { value: "ruins", label: "Ruins" },
];

type BorderPoint = { x: number; z: number };

type Border = {
  id: string;
  name: string;
  dimension: MarkerDimension;
  color: string;
  points: BorderPoint[];
};

type BorderPointDraft = { x: string; z: string };

const BLANK_BORDER_FORM = {
  name: "",
  dimension: "overworld" as MarkerDimension,
  color: "#ff3b30",
  points: [
    { x: "", z: "" },
    { x: "", z: "" },
    { x: "", z: "" },
  ] as BorderPointDraft[],
};

type Trailer = {
  episode: number;
  fileName: string;
  videoBytes: number;
  posterFileName: string | null;
  updatedAt: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [markerEditDraft, setMarkerEditDraft] = useState<MarkerDraft | null>(
    null,
  );
  const [borders, setBorders] = useState<Border[] | null>(null);
  const [bordersDirty, setBordersDirty] = useState(false);
  const [borderForm, setBorderForm] = useState(BLANK_BORDER_FORM);
  const [borderMessage, setBorderMessage] = useState("");
  const [drawMode, setDrawMode] = useState(false);
  const mapProxyRef = useRef<HTMLIFrameElement>(null);
  const [locationRequests, setLocationRequests] = useState<
    LocationRequest[] | null
  >(null);
  const [locationDrafts, setLocationDrafts] = useState<
    Record<string, LocationDraft>
  >({});
  const [locationMessage, setLocationMessage] = useState("");
  const [trailers, setTrailers] = useState<Trailer[] | null>(null);
  const [nextEpisode, setNextEpisode] = useState<number | null>(null);
  const [episodeOverride, setEpisodeOverride] = useState("");
  const [trailerMessage, setTrailerMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);

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

  const loadBorders = useCallback(() => {
    fetch("/api/mc/borders")
      .then((r) => r.json())
      .then((data) => {
        setBorders(data.borders ?? []);
        setBordersDirty(Boolean(data.dirty));
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

  const loadTrailers = useCallback(() => {
    fetch("/api/mc/trailers")
      .then((r) => r.json())
      .then((data) => {
        setTrailers(data.trailers ?? []);
        setNextEpisode(data.nextEpisode ?? null);
      });
  }, []);

  useEffect(() => {
    loadPlayers();
    loadRequests();
    loadMarkers();
    loadBorders();
    loadLocationRequests();
    loadTrailers();
  }, [
    loadPlayers,
    loadRequests,
    loadMarkers,
    loadBorders,
    loadLocationRequests,
    loadTrailers,
  ]);

  useEffect(() => {
    function handleMapMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "bluemap-draw-tool" || data.type !== "point") {
        return;
      }
      setBorderForm((prev) => ({
        ...prev,
        points: [...prev.points, { x: String(data.x), z: String(data.z) }],
      }));
    }
    window.addEventListener("message", handleMapMessage);
    return () => window.removeEventListener("message", handleMapMessage);
  }, []);

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
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setMarkers(data.markers ?? []);
      setMarkersDirty(Boolean(data.dirty));
      setMarkerForm({ ...BLANK_MARKER_FORM });
      setMarkerMessage(
        data.applyError
          ? `Marker added, but publishing to BlueMap failed: ${data.applyError}`
          : "",
      );
    } else {
      setMarkerMessage(data.error ?? "Failed to add marker.");
    }
    setBusy(null);
  }

  async function removeMarker(id: string) {
    setBusy(`marker:${id}`);
    setMarkerMessage("");
    const response = await fetch("/api/mc/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const data = await response.json().catch(() => ({}));
    setMarkers(data.markers ?? []);
    setMarkersDirty(Boolean(data.dirty));
    if (data.applyError) {
      setMarkerMessage(`Marker removed, but updating BlueMap failed: ${data.applyError}`);
    }
    setBusy(null);
  }

  function startEditMarker(marker: Marker) {
    setEditingMarkerId(marker.id);
    setMarkerEditDraft({
      name: marker.name,
      x: String(marker.x),
      y: String(marker.y),
      z: String(marker.z),
      dimension: marker.dimension,
      icon: marker.icon,
    });
    setMarkerMessage("");
  }

  function cancelEditMarker() {
    setEditingMarkerId(null);
    setMarkerEditDraft(null);
  }

  function updateMarkerEditDraft(patch: Partial<MarkerDraft>) {
    setMarkerEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveMarkerEdit(id: string) {
    if (!markerEditDraft) return;
    setBusy(`marker-edit:${id}`);
    setMarkerMessage("");
    const response = await fetch("/api/mc/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "edit",
        id,
        name: markerEditDraft.name.trim(),
        x: Number(markerEditDraft.x),
        y: Number(markerEditDraft.y),
        z: Number(markerEditDraft.z),
        dimension: markerEditDraft.dimension,
        icon: markerEditDraft.icon,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setMarkers(data.markers ?? []);
      setMarkersDirty(Boolean(data.dirty));
      setEditingMarkerId(null);
      setMarkerEditDraft(null);
      if (data.applyError) {
        setMarkerMessage(
          `Marker updated, but publishing to BlueMap failed: ${data.applyError}`,
        );
      }
    } else {
      setMarkerMessage(data.error ?? "Failed to update marker.");
    }
    setBusy(null);
  }

  function updateBorderPoint(index: number, patch: Partial<BorderPointDraft>) {
    setBorderForm((prev) => ({
      ...prev,
      points: prev.points.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  }

  function addBorderPointRow() {
    setBorderForm((prev) => ({
      ...prev,
      points: [...prev.points, { x: "", z: "" }],
    }));
  }

  function removeBorderPointRow(index: number) {
    setBorderForm((prev) => ({
      ...prev,
      points: prev.points.filter((_, i) => i !== index),
    }));
  }

  async function addBorderFromForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBorderMessage("");
    setBusy("border-add");
    const response = await fetch("/api/mc/borders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        name: borderForm.name.trim(),
        dimension: borderForm.dimension,
        color: borderForm.color,
        points: borderForm.points.map((p) => ({
          x: Number(p.x),
          z: Number(p.z),
        })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setBorders(data.borders ?? []);
      setBordersDirty(Boolean(data.dirty));
      setBorderForm({
        ...BLANK_BORDER_FORM,
        points: BLANK_BORDER_FORM.points.map((p) => ({ ...p })),
      });
    } else {
      setBorderMessage(data.error ?? "Failed to add border.");
    }
    setBusy(null);
  }

  async function removeBorder(id: string) {
    setBusy(`border:${id}`);
    const response = await fetch("/api/mc/borders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    const data = await response.json().catch(() => ({}));
    setBorders(data.borders ?? []);
    setBordersDirty(Boolean(data.dirty));
    setBusy(null);
  }

  async function applyBordersToMap() {
    setBorderMessage("");
    setBusy("border-apply");
    const response = await fetch("/api/mc/borders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setBorders(data.borders ?? []);
      setBordersDirty(Boolean(data.dirty));
      setBorderMessage(
        "Applied. BlueMap is reloading — borders appear in a few seconds.",
      );
    } else {
      setBorderMessage(data.error ?? "Failed to apply borders.");
    }
    setBusy(null);
  }

  async function uploadTrailer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTrailerMessage("");

    const videoFile = videoInputRef.current?.files?.[0];
    if (!videoFile) {
      setTrailerMessage("Choose an .mp4 file to upload.");
      return;
    }

    const targetEpisode =
      episodeOverride.trim() !== "" ? Number(episodeOverride) : nextEpisode;
    if (!targetEpisode || !Number.isInteger(targetEpisode) || targetEpisode < 1) {
      setTrailerMessage("Episode number must be a positive whole number.");
      return;
    }

    const existing = trailers?.find((t) => t.episode === targetEpisode);
    if (
      existing &&
      !window.confirm(
        `Episode ${targetEpisode} already has a trailer uploaded. Replace it?`,
      )
    ) {
      return;
    }

    const formData = new FormData();
    formData.append("episode", String(targetEpisode));
    formData.append("video", videoFile);
    const posterFile = posterInputRef.current?.files?.[0];
    if (posterFile) formData.append("poster", posterFile);

    setUploading(true);
    const response = await fetch("/api/mc/trailers", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      setTrailers(data.trailers ?? []);
      setEpisodeOverride("");
      if (videoInputRef.current) videoInputRef.current.value = "";
      if (posterInputRef.current) posterInputRef.current.value = "";
      const highest = (data.trailers as Trailer[] | undefined)?.reduce(
        (max: number, t: Trailer) => Math.max(max, t.episode),
        0,
      );
      setTrailerMessage(
        `Episode ${targetEpisode} uploaded${
          highest === targetEpisode ? " — now the latest on the site." : "."
        }`,
      );
      loadTrailers();
    } else {
      setTrailerMessage(data.error ?? "Failed to upload trailer.");
    }
    setUploading(false);
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
        data.applyError
          ? `Approved, but publishing to BlueMap failed: ${data.applyError}`
          : "Approved and published to the live map.",
      );
    } else {
      setLocationMessage(data.error ?? "Failed to approve request.");
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <h2 className="mb-4 text-base font-semibold">Players</h2>
          {players === null ? (
            <p className="text-sm text-ink-dim">Loading...</p>
          ) : players.length === 0 ? (
            <p className="text-sm text-ink-dim">No one has played yet.</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-panel">
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
            </div>
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
            <ul className="flex max-h-[24rem] flex-col gap-3 overflow-y-auto">
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
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <h2 className="mb-4 text-base font-semibold">
            BlueMap markers
            {markersDirty && (
              <span className="ml-2 rounded bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
                sync failed — see message on the right
              </span>
            )}
          </h2>

          {markers === null ? (
            <p className="text-sm text-ink-dim">Loading...</p>
          ) : markers.length === 0 ? (
            <p className="text-sm text-ink-dim">No markers yet.</p>
          ) : (
            <div className="max-h-[36rem] overflow-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-panel-border text-ink-dim">
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Position</th>
                    <th className="py-2 pr-4 font-medium">Dimension</th>
                    <th className="py-2 pr-4 font-medium">Icon</th>
                    <th className="py-2 pr-4 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {markers.map((marker) => {
                    const isEditing = editingMarkerId === marker.id;
                    const draft = markerEditDraft;
                    return (
                      <tr
                        key={marker.id}
                        className="border-b border-panel-border/60"
                      >
                        <td className="py-3 pr-4">
                          {isEditing && draft ? (
                            <input
                              value={draft.name}
                              onChange={(e) =>
                                updateMarkerEditDraft({ name: e.target.value })
                              }
                              maxLength={48}
                              className="input"
                            />
                          ) : (
                            marker.name
                          )}
                        </td>
                        <td className="py-3 pr-4 tabular-nums">
                          {isEditing && draft ? (
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={draft.x}
                                onChange={(e) =>
                                  updateMarkerEditDraft({ x: e.target.value })
                                }
                                className="input w-16"
                              />
                              <input
                                type="number"
                                value={draft.y}
                                onChange={(e) =>
                                  updateMarkerEditDraft({ y: e.target.value })
                                }
                                className="input w-16"
                              />
                              <input
                                type="number"
                                value={draft.z}
                                onChange={(e) =>
                                  updateMarkerEditDraft({ z: e.target.value })
                                }
                                className="input w-16"
                              />
                            </div>
                          ) : (
                            `${marker.x}, ${marker.y}, ${marker.z}`
                          )}
                        </td>
                        <td className="py-3 pr-4 capitalize">
                          {isEditing && draft ? (
                            <select
                              value={draft.dimension}
                              onChange={(e) =>
                                updateMarkerEditDraft({
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
                          ) : (
                            marker.dimension
                          )}
                        </td>
                        <td className="py-3 pr-4 capitalize">
                          {isEditing && draft ? (
                            <select
                              value={draft.icon}
                              onChange={(e) =>
                                updateMarkerEditDraft({
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
                          ) : (
                            marker.icon
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center justify-end gap-2">
                            {isEditing ? (
                              <>
                                <button
                                  className="btn btn-accent px-2 py-1"
                                  disabled={busy === `marker-edit:${marker.id}`}
                                  onClick={() => saveMarkerEdit(marker.id)}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn btn-ghost px-2 py-1"
                                  onClick={cancelEditMarker}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-ghost px-2 py-1"
                                  title="Edit marker"
                                  onClick={() => startEditMarker(marker)}
                                >
                                  ✎
                                </button>
                                <button
                                  className="btn btn-danger ml-1"
                                  disabled={busy === `marker:${marker.id}`}
                                  onClick={() => removeMarker(marker.id)}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel p-6">
        <h2 className="mb-1 text-base font-semibold">Location requests</h2>
        <p className="mb-4 text-xs text-ink-dim">
          Player-submitted map names. Edit anything, then Accept to add it to
          the markers on the left and publish it live, or Deny to discard it.
        </p>
        {locationMessage && (
          <p className="mb-4 text-xs text-ink-dim">{locationMessage}</p>
        )}
        {locationRequests === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : locationRequests.length === 0 ? (
          <p className="text-sm text-ink-dim">No pending location requests.</p>
        ) : (
          <ul className="flex max-h-[24rem] flex-col gap-4 overflow-y-auto">
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

        <div className="mt-6 border-t border-panel-border/60 pt-6">
          <h3 className="mb-3 text-sm font-semibold">Add marker manually</h3>
          <form
            onSubmit={addMarkerFromForm}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
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
            <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
              <button
                type="submit"
                disabled={busy === "marker-add"}
                className="btn btn-accent"
              >
                {busy === "marker-add" ? "Adding..." : "Add marker"}
              </button>
              {markerMessage && (
                <p className="text-xs text-danger">{markerMessage}</p>
              )}
            </div>
          </form>
        </div>
        </section>
      </div>

      <section className="panel p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            Map borders
            {bordersDirty && (
              <span className="ml-2 rounded bg-danger/20 px-2 py-0.5 text-xs font-medium text-danger">
                unapplied changes
              </span>
            )}
          </h2>
          <button
            className="btn btn-accent"
            disabled={!bordersDirty || busy === "border-apply"}
            onClick={applyBordersToMap}
          >
            {busy === "border-apply" ? "Applying..." : "Apply to map"}
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-dim">
          Outlines a region with a colored border line (no fill), like a state
          or kingdom boundary. Enter the X/Z corners of the outline in order
          &mdash; you need at least 3 points.
        </p>

        <form
          onSubmit={addBorderFromForm}
          className="mb-6 flex flex-col gap-3 border-b border-panel-border/60 pb-6"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs text-ink-dim">Name</span>
              <input
                value={borderForm.name}
                onChange={(e) =>
                  setBorderForm({ ...borderForm, name: e.target.value })
                }
                maxLength={48}
                required
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-dim">Dimension</span>
              <select
                value={borderForm.dimension}
                onChange={(e) =>
                  setBorderForm({
                    ...borderForm,
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
              <span className="text-xs text-ink-dim">Color</span>
              <input
                type="color"
                value={borderForm.color}
                onChange={(e) =>
                  setBorderForm({ ...borderForm, color: e.target.value })
                }
                className="input h-[38px] p-1"
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-dim">Points (X, Z)</span>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-xs"
                onClick={() => setDrawMode((v) => !v)}
              >
                {drawMode ? "Hide map" : "Draw on map"}
              </button>
            </div>
            {drawMode && (
              <div className="flex flex-col gap-1">
                <iframe
                  ref={mapProxyRef}
                  src="/api/mc/map-proxy/index.html"
                  onLoad={() => {
                    mapProxyRef.current?.contentWindow?.postMessage(
                      { source: "admin-border-tool", type: "set-active", active: true },
                      window.location.origin,
                    );
                  }}
                  className="h-[420px] w-full rounded-lg border border-panel-border"
                />
                <p className="text-xs text-ink-dim">
                  Click anywhere on the map to add a point below.
                </p>
              </div>
            )}
            {borderForm.points.map((point, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="X"
                  value={point.x}
                  onChange={(e) => updateBorderPoint(i, { x: e.target.value })}
                  required
                  className="input w-28"
                />
                <input
                  type="number"
                  placeholder="Z"
                  value={point.z}
                  onChange={(e) => updateBorderPoint(i, { z: e.target.value })}
                  required
                  className="input w-28"
                />
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1"
                  disabled={borderForm.points.length <= 3}
                  onClick={() => removeBorderPointRow(i)}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost self-start"
              onClick={addBorderPointRow}
            >
              + Add point
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy === "border-add"}
              className="btn btn-accent"
            >
              {busy === "border-add" ? "Adding..." : "Add border"}
            </button>
            {borderMessage && (
              <p className="text-xs text-ink-dim">{borderMessage}</p>
            )}
          </div>
        </form>

        {borders === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : borders.length === 0 ? (
          <p className="text-sm text-ink-dim">No borders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-panel-border text-ink-dim">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Dimension</th>
                  <th className="py-2 pr-4 font-medium">Color</th>
                  <th className="py-2 pr-4 font-medium">Points</th>
                  <th className="py-2 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {borders.map((border) => (
                  <tr key={border.id} className="border-b border-panel-border/60">
                    <td className="py-3 pr-4">{border.name}</td>
                    <td className="py-3 pr-4 capitalize">{border.dimension}</td>
                    <td className="py-3 pr-4">
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-panel-border align-middle"
                        style={{ backgroundColor: border.color }}
                      />
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {border.points.length}
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        className="btn btn-danger"
                        disabled={busy === `border:${border.id}`}
                        onClick={() => removeBorder(border.id)}
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

      <section className="panel p-6">
        <h2 className="mb-1 text-base font-semibold">
          Minecraft Monday trailers
        </h2>
        <p className="mb-4 text-xs text-ink-dim">
          Upload an episode&apos;s trailer .mp4. It&apos;s copied into the
          mc.byjohnmichael.com media folder as the next episode number and
          becomes the latest trailer shown on the homepage automatically.
        </p>

        <form
          onSubmit={uploadTrailer}
          className="mb-6 grid gap-3 border-b border-panel-border/60 pb-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-dim">Episode number</span>
            <input
              type="number"
              min={1}
              step={1}
              value={episodeOverride}
              onChange={(e) => setEpisodeOverride(e.target.value)}
              placeholder={nextEpisode ? String(nextEpisode) : "…"}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-1">
            <span className="text-xs text-ink-dim">Trailer video (.mp4)</span>
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,.mp4"
              required
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-1">
            <span className="text-xs text-ink-dim">
              Poster image (optional)
            </span>
            <input
              ref={posterInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="input"
            />
          </label>
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-1">
            <button type="submit" disabled={uploading} className="btn btn-accent">
              {uploading ? "Uploading…" : "Upload & publish"}
            </button>
          </div>
          {trailerMessage && (
            <p className="text-xs text-ink-dim sm:col-span-2 lg:col-span-4">
              {trailerMessage}
            </p>
          )}
        </form>

        {trailers === null ? (
          <p className="text-sm text-ink-dim">Loading...</p>
        ) : trailers.length === 0 ? (
          <p className="text-sm text-ink-dim">No trailers uploaded yet.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b border-panel-border text-ink-dim">
                  <th className="py-2 pr-4 font-medium">Episode</th>
                  <th className="py-2 pr-4 font-medium">File</th>
                  <th className="py-2 pr-4 font-medium">Size</th>
                  <th className="py-2 pr-4 font-medium">Poster</th>
                  <th className="py-2 pr-4 font-medium">Updated</th>
                  <th className="py-2 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {[...trailers]
                  .sort((a, b) => b.episode - a.episode)
                  .map((trailer, i) => (
                    <tr
                      key={trailer.episode}
                      className="border-b border-panel-border/60"
                    >
                      <td className="py-3 pr-4 tabular-nums">
                        {trailer.episode}
                        {i === 0 && (
                          <span className="ml-2 rounded bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                            latest
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">{trailer.fileName}</td>
                      <td className="py-3 pr-4 tabular-nums">
                        {formatBytes(trailer.videoBytes)}
                      </td>
                      <td className="py-3 pr-4">
                        {trailer.posterFileName ?? (
                          <span className="text-ink-dim">none</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-ink-dim">
                        {new Date(trailer.updatedAt).toLocaleString()}
                      </td>
                      <td className="py-3 pr-4">
                        <a
                          className="btn btn-ghost"
                          href={`https://mc.byjohnmichael.com/trailers/${trailer.episode}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
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

// byjohnmichael*
