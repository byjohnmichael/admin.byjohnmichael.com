import { NextResponse } from "next/server";
import {
  getNextEpisodeNumber,
  listTrailers,
  saveTrailer,
  POSTER_EXTS,
} from "@/lib/trailers";

// Keep in lockstep with experimental.proxyClientMaxBodySize in next.config.ts —
// proxy.ts runs on every route and silently truncates bodies past that limit
// before they ever reach this handler, so this check must not exceed it.
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500MB
const MAX_POSTER_BYTES = 15 * 1024 * 1024; // 15MB

export async function GET() {
  const [trailers, nextEpisode] = await Promise.all([
    listTrailers(),
    getNextEpisodeNumber(),
  ]);
  return NextResponse.json({ trailers, nextEpisode });
}

function extFromName(name: string): string | null {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : null;
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const video = formData.get("video");
  if (!(video instanceof File) || video.size === 0) {
    return NextResponse.json(
      { error: "A video file is required." },
      { status: 400 },
    );
  }
  if (extFromName(video.name) !== ".mp4") {
    return NextResponse.json(
      { error: "Video must be an .mp4 file." },
      { status: 400 },
    );
  }
  if (video.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: "Video is too large (500MB max)." },
      { status: 400 },
    );
  }

  const episodeRaw = formData.get("episode");
  let episode: number;
  if (typeof episodeRaw === "string" && episodeRaw.trim() !== "") {
    episode = Number(episodeRaw);
    if (!Number.isInteger(episode) || episode < 1) {
      return NextResponse.json(
        { error: "Episode number must be a positive whole number." },
        { status: 400 },
      );
    }
  } else {
    episode = await getNextEpisodeNumber();
  }

  let posterBuffer: Buffer | null = null;
  let posterExt: string | null = null;
  const poster = formData.get("poster");
  if (poster instanceof File && poster.size > 0) {
    const ext = extFromName(poster.name);
    if (!ext || !POSTER_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: "Poster must be a .jpg, .png, or .webp image." },
        { status: 400 },
      );
    }
    if (poster.size > MAX_POSTER_BYTES) {
      return NextResponse.json(
        { error: "Poster image is too large (15MB max)." },
        { status: 400 },
      );
    }
    posterBuffer = Buffer.from(await poster.arrayBuffer());
    posterExt = ext;
  }

  const videoBuffer = Buffer.from(await video.arrayBuffer());
  const result = await saveTrailer({
    episode,
    video: videoBuffer,
    poster: posterBuffer,
    posterExt,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const trailers = await listTrailers();
  return NextResponse.json({
    ok: true,
    replaced: result.replaced,
    trailer: result.trailer,
    trailers,
  });
}

// byjohnmichael*
