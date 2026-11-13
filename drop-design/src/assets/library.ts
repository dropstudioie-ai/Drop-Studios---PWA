import data from './library.json';

export interface LibraryImage { src: string; name: string; width: number; height: number; categories: string[] }

/** Built-in images: the studio's own photos and original vector artwork made for this app (no third-party stock). */
export const LIBRARY = data as LibraryImage[];
export const LIBRARY_CATEGORIES = ['all', 'drop', 'dance', 'people', 'studio', 'music', 'party', 'backgrounds'];
export const lib = (match: string) => LIBRARY.find((l) => l.src.includes(match))!;
