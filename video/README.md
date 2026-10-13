# huddle launch video

A 2-minute launch film for huddle, made with [Remotion](https://remotion.dev). It reuses the site's own parts
(the bench, the logos, the type), and the voiceover, effects and ambient bed come from ElevenLabs.

```sh
npm install
npm run studio     # preview and scrub in the browser
npm run render     # out/huddle-launch.mp4 (1920×1080, 30 fps)
```

## Changing the words

The script is `narration.json`, one segment per beat. After editing it:

```sh
npm run voice      # re-speaks only the segments whose text, voice or settings changed
```

Every scene is timed from the voice: `src/vo.json` holds the time of each spoken word, and the scenes cue
their motion from it (`cue("debate", "disagrees")`), so a re-spoken line re-times its scene by itself.

To try another voice, change `voice.id` in `narration.json` and run `npm run voice -- --force`.
Short samples of other voices are in `out/voice-samples/`.

## Music and sounds

The score is six short cues, one per part of the story (`music.json`): unease while you're the messenger,
a lift at the reveal, a focused pulse through the debate, a resolve when they agree, calm confidence while
you steer, and a finale that rings out with the last frame. `npm run music` makes any missing cue, cuts it to
its part (timed from the voice, like the scenes) and levels it with loudnorm; the video crossfades the cues
and dips them a little under the voice. They come from the ElevenLabs sound-effects model because its
music API needs a paid plan.

`npm run sfx` makes the small effects in `public/audio/sfx/` from the prompts in `scripts/sfx.mjs`
(`-- --force <name>` makes one again).

The final mix is mastered to -16 LUFS: `npm run render` and then

```sh
npx remotion ffmpeg -i out/raw.mp4 -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=9 -c:a aac -b:a 256k out/huddle-launch.mp4
```

The ElevenLabs key is read from `ELEVENLABS_API_KEY` or `~/.config/elevenlabs/key`.
