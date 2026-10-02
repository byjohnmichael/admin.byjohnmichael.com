import { NextResponse } from "next/server";
import {
  addMarker,
  deleteMarker,
  updateMarker,
  listMarkers,
  DIMENSIONS,
  ICONS,
  type Dimension,
  type Icon,
} from "@/lib/bluemapMarkers";

const NAME_MAX = 48;
const XZ_LIMIT = 30_000_000;
const Y_MIN = -2048;
const Y_MAX = 2048;

export async function GET() {
  return NextResponse.json(await listMarkers());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === "delete") {
    if (typeof body?.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }
    return NextResponse.json(await deleteMarker(body.id));
  }

  if (action === "add" || action === "edit") {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const x = Number(body?.x);
    const y = Number(body?.y);
    const z = Number(body?.z);
    const dimension = body?.dimension as Dimension;
    const icon = body?.icon as Icon;

    if (action === "edit" && (typeof body?.id !== "string" || !body.id)) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }
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
    if (!ICONS.includes(icon)) {
      return NextResponse.json({ error: "Invalid icon." }, { status: 400 });
    }

    if (action === "edit") {
      return NextResponse.json(
        await updateMarker(body.id, { name, x, y, z, dimension, icon }),
      );
    }
    return NextResponse.json(
      await addMarker({ name, x, y, z, dimension, icon }),
    );
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// byjohnmichael*
