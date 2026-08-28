import { Effect } from "effect";

export type LocalMediaKind = "video" | "repaired-audio";

export interface LocalMediaHandle {
  readonly kind: LocalMediaKind;
  readonly file: File;
  readonly objectUrl: string;
}

export class LocalMediaSession {
  private handles = new Map<LocalMediaKind, LocalMediaHandle>();

  replace(kind: LocalMediaKind, file: File): LocalMediaHandle {
    this.release(kind);
    const handle = { kind, file, objectUrl: URL.createObjectURL(file) } as const;
    this.handles.set(kind, handle);
    return handle;
  }

  get(kind: LocalMediaKind): LocalMediaHandle | null {
    return this.handles.get(kind) ?? null;
  }

  release(kind: LocalMediaKind): void {
    const handle = this.handles.get(kind);
    if (handle) URL.revokeObjectURL(handle.objectUrl);
    this.handles.delete(kind);
  }

  releaseAll(): void {
    for (const kind of [...this.handles.keys()]) this.release(kind);
  }
}

const toHex = (bytes: Uint8Array): string => [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");

export const fingerprintLocalMedia = (file: File) => Effect.tryPromise({
  try: async () => {
    const sampleSize = 1024 * 1024;
    const head = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - sampleSize)).arrayBuffer());
    const metadata = new TextEncoder().encode(`local_media_fingerprint_v1:${file.size}:${file.type}`);
    const material = new Uint8Array(metadata.length + head.length + tail.length);
    material.set(metadata);
    material.set(head, metadata.length);
    material.set(tail, metadata.length + head.length);
    const digest = await crypto.subtle.digest("SHA-256", material);
    return `local-media-v1:${toHex(new Uint8Array(digest))}`;
  },
  catch: (cause) => new Error(`Could not fingerprint local media: ${String(cause)}`),
});
