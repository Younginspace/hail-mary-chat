// P5 F1: client-side daily quota and share-for-bonus logic were removed.
// Registration is now forced, so all access control lives on the server.
//
// ChatMode is kept because ChatInterface + useRockyTTS still branch on
// text vs voice (F2 will collapse these into a single mode + toggle).

export type ChatMode = 'text' | 'voice';
