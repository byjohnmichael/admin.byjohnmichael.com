import { NextResponse } from "next/server";
import {
  addBorder,
  applyBorders,
  deleteBorder,
  listBorders,
  type Point,
} from "@/lib/bluemapBorders";
import { DIMENSIONS, type Dimension } from "@/lib/bluemapMarkers";

const NAME_MAX = 48;
const XZ_LIMIT = 30_000_000;
const MIN_POINTS = 3;
const MAX_POINTS = 200;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  return NextResponse.json(await listBorders());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === "apply") {
    const result = await applyBorders();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(await listBorders());
  }

  if (action === "delete") {
    if (typeof body?.id !== "string" || !body.id) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }
    return NextResponse.json(await deleteBorder(body.id));
  }

  if (action === "add") {
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const color = typeof body?.color === "string" ? body.color : "";
    const dimension = body?.dimension as Dimension;
    const rawPoints = Array.isArray(body?.points) ? body.points : [];

    if (!name || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Name must be 1-${NAME_MAX} characters.` },
        { status: 400 },
      );
    }
    if (!DIMENSIONS.includes(dimension)) {
      return NextResponse.json({ error: "Invalid dimension." }, { status: 400 });
    }
    if (!COLOR_PATTERN.test(color)) {
      return NextResponse.json(
        { error: "Color must be a hex value like #ff0000." },
        { status: 400 },
      );
    }
    if (rawPoints.length < MIN_POINTS || rawPoints.length > MAX_POINTS) {
      return NextResponse.json(
        {
          error: `A border needs between ${MIN_POINTS} and ${MAX_POINTS} points.`,
        },
        { status: 400 },
      );
    }

    const points: Point[] = [];
    for (const p of rawPoints) {
      const x = Number(p?.x);
      const z = Number(p?.z);
      if (
        !Number.isInteger(x) ||
        !Number.isInteger(z) ||
        Math.abs(x) > XZ_LIMIT ||
        Math.abs(z) > XZ_LIMIT
      ) {
        return NextResponse.json(
          { error: "Every point's X and Z must be whole numbers." },
          { status: 400 },
        );
      }
      points.push({ x, z });
    }

    return NextResponse.json(await addBorder({ name, dimension, color, points }));
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

// byjohnmichael*
