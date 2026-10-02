import { NextResponse } from "next/server";
import {
  getLocationRequests,
  removeLocationRequest,
  LOCATION_TYPES,
  type LocationType,
} from "@/lib/store";
import {
  addMarker,
  DIMENSIONS,
  type Dimension,
} from "@/lib/bluemapMarkers";

const NAME_MAX = 48;
const XZ_LIMIT = 30_000_000;
const Y_MIN = -2048;
const Y_MAX = 2048;

export async function GET() {
  return NextResponse.json({ requests: await getLocationRequests() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const id = body?.id;

  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  if (action === "deny") {
    await removeLocationRequest(id);
    return NextResponse.json({ requests: await getLocationRequests() });
  }

  if (action === "accept") {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const x = Number(body?.x);
    const y = Number(body?.y);
    const z = Number(body?.z);
    const dimension = body?.dimension as Dimension;
    const type = body?.type as LocationType;

    if (!name || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Name must be 1-${NAME_MAX} characters.` },
        { status: 400 },
      );
    }
    for (const [label, value, lo, hi] of [
      ["X", x, -XZ_LIMIT, XZ_LIMIT],
      ["Y", y, Y_MIN, Y_MAX],
      ["Z", z, -XZ_LIMIT, XZ_LIMIT],
    ] as const) {
      if (!Number.isInteger(value) || value < lo || value > hi) {
        return NextResponse.json(
          { error: `${label} must be a whole number between ${lo} and ${hi}.` },
          { status: 400 },
        );
      }
    }
    if (!DIMENSIONS.includes(dimension)) {
      return NextResponse.json({ error: "Invalid dimension." }, { status: 400 });
    }
    if (!(LOCATION_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "Invalid type." }, { status: 400 });
    }

    // A location's type doubles as its marker icon (icon-<type>.svg).
    const state = await addMarker({
      name,
      x,
      y,
      z,
      dimension,
      icon: type,
    });
    await removeLocationRequest(id);

    return NextResponse.json({
      requests: await getLocationRequests(),
      markers: state.markers,
      dirty: state.dirty,
      applyError: state.applyError,
    });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// byjohnmichael*
