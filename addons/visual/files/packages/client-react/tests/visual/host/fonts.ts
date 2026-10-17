// Loads every font face the page's stylesheets declare, so no picture is taken
// in a fallback face. No React and no DOM library import: Node loads this file
// in a test, and the browser passes it `document.fonts`.

/** The part of a `FontFace` this file reads. */
interface Face {
  family: string;
  weight: string;
  style: string;
  load: () => Promise<unknown>;
}

/** `document.fonts`, as far as this file reads it. */
interface FaceSet extends Iterable<Face> {
  ready: Promise<unknown>;
}

/**
 * Loads each declared face, then waits for `ready`. `ready` alone resolves
 * before a face nothing has used yet is fetched, so the glyphs would swap in
 * after the picture. A face that cannot load throws, naming it.
 */
export async function loadEveryFace(fonts: FaceSet): Promise<void> {
  const faces = [...fonts];

  const results = await Promise.allSettled(
    faces.map((face) => {
      return face.load();
    }),
  );

  results.forEach((result, index) => {
    const face = faces[index];

    if (result.status === "rejected" && face !== undefined) {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);

      throw new Error(
        `the font ${face.family} ${face.weight} ${face.style} did not load: ${reason}`,
      );
    }
  });

  await fonts.ready;
}
