import { promises as fs } from "fs";
import path from "path";

// Same physical folder the mc.byjohnmichael.com site reads from
// (src/lib/trailers.ts there) — this app writes, that app serves.
const TRAILERS_DIR =
  process.env.TRAILERS_DIR ??
  "/var/www/mc.byjohnmichael.com/mc-media/trailers";

// MM-001.mp4 -> episode 1, MM-014.mp4 -> episode 14. Keep in sync with the
// mc-site's copy of this regex — it decides what counts as "the latest".
const NAME_RE = /^MM-0*(\d+)\.mp4$/i;
const POSTER_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_EPISODE = 9999;

export type Trailer = {
  episode: number;
  fileName: string;
  videoBytes: number;
  posterFileName: string | null;
  updatedAt: string;
};

export function episodeFileBase(episode: number): string {
  return `MM-${String(episode).padStart(3, "0")}`;
}

async function readDir(): Promise<string[]> {
  try {
    return await fs.readdir(/* turbopackIgnore: true */ TRAILERS_DIR);
  } catch {
    return [];
  }
}

export async function listTrailers(): Promise<Trailer[]> {
  const entries = await readDir();
  const present = new Set(entries);
  const trailers: Trailer[] = [];

  for (const name of entries) {
    const match = name.match(NAME_RE);
    if (!match) continue;
    const base = name.replace(/\.mp4$/i, "");
    const posterName = POSTER_EXTS.map((ext) => base + ext).find((candidate) =>
      present.has(candidate),
    );
    const stat = await fs.stat(
      path.join(/* turbopackIgnore: true */ TRAILERS_DIR, name),
    );
    trailers.push({
      episode: Number(match[1]),
      fileName: name,
      videoBytes: stat.size,
      posterFileName: posterName ?? null,
      updatedAt: stat.mtime.toISOString(),
    });
  }

  trailers.sort((a, b) => a.episode - b.episode);
  return trailers;
}

/** Highest existing episode + 1, or 1 if there are none yet. */
export async function getNextEpisodeNumber(): Promise<number> {
  const all = await listTrailers();
  return all.length > 0 ? all[all.length - 1].episode + 1 : 1;
}

export type SaveTrailerInput = {
  episode: number;
  video: Buffer;
  poster: Buffer | null;
  posterExt: string | null;
};

export type SaveTrailerResult =
  | { ok: true; trailer: Trailer; replaced: boolean }
  | { ok: false; error: string };

/**
 * Writes MM-0{episode}.mp4 (+ optional poster) into TRAILERS_DIR. Videos are
 * written to a temp name first and renamed into place atomically so the
 * public site — which lists this directory on every request — never sees a
 * partially-written file.
 */
export async function saveTrailer(
  input: SaveTrailerInput,
): Promise<SaveTrailerResult> {
  if (
    !Number.isInteger(input.episode) ||
    input.episode < 1 ||
    input.episode > MAX_EPISODE
  ) {
    return { ok: false, error: `Episode must be between 1 and ${MAX_EPISODE}.` };
  }

  const base = episodeFileBase(input.episode);
  const videoName = `${base}.mp4`;
  const videoPath = path.join(/* turbopackIgnore: true */ TRAILERS_DIR, videoName);
  const tmpPath = path.join(
    /* turbopackIgnore: true */ TRAILERS_DIR,
    `.${videoName}.${Date.now()}.tmp`,
  );

  let replaced = false;
  try {
    await fs.access(videoPath);
    replaced = true;
  } catch {
    // no existing file for this episode
  }

  try {
    await fs.mkdir(/* turbopackIgnore: true */ TRAILERS_DIR, { recursive: true });
    await fs.writeFile(tmpPath, input.video);
    await fs.rename(tmpPath, videoPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to write video file.",
    };
  }

  let posterFileName: string | null = null;
  if (input.poster && input.posterExt) {
    // Clear out any previously-saved poster under a different extension so
    // stale art doesn't linger next to the new one.
    for (const ext of POSTER_EXTS) {
      if (ext === input.posterExt) continue;
      await fs
        .unlink(path.join(/* turbopackIgnore: true */ TRAILERS_DIR, base + ext))
        .catch(() => {});
    }
    posterFileName = base + input.posterExt;
    const posterTmp = path.join(
      /* turbopackIgnore: true */ TRAILERS_DIR,
      `.${posterFileName}.${Date.now()}.tmp`,
    );
    try {
      await fs.writeFile(posterTmp, input.poster);
      await fs.rename(
        posterTmp,
        path.join(/* turbopackIgnore: true */ TRAILERS_DIR, posterFileName),
      );
    } catch {
      await fs.unlink(posterTmp).catch(() => {});
      posterFileName = null;
    }
  }

  const stat = await fs.stat(videoPath);
  return {
    ok: true,
    replaced,
    trailer: {
      episode: input.episode,
      fileName: videoName,
      videoBytes: stat.size,
      posterFileName,
      updatedAt: stat.mtime.toISOString(),
    },
  };
}

export { POSTER_EXTS };

// byjohnmichael*
