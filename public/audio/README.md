# Your own sound recordings

Drop audio files in this folder and the table uses them instead of the built-in synthesised sounds. The name decides what a file replaces:

- `scene-<name>.ogg` (or .mp3, .wav, .m4a, .webm, .flac): a looping ambient scene. Names: forest, night, wind, cave, dungeon, tavern, town, rain, fire.
- `mood-<name>.ogg`: a looping mood under the scene. Names: tense, combat, eerie, triumph (triumph plays once).
- `sfx-<name>.ogg`: a one-shot effect. Names: door, creak, thunder, bell, roar, howl, clash, magic, explosion, splash.

For example `scene-rain.ogg` or `sfx-door.wav`. Make loops that join without a click (start and end at the same level). Only use recordings you have the right to use: public-domain (CC0) or royalty-free sounds are the safe choice, and check the licence before committing them if this repository is shared.

The Sound Test page shows which sounds are recordings and which are synthesised.

The recordings that came with the app, and their sources and licences, are listed in CREDITS.md. A scene recording can also have short extras played over it now and then: the night scene plays sfx-owl and sfx-howl (see EXTRAS in public/ambience.js).
