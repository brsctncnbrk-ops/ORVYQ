#!/usr/bin/env python3
import argparse
import json
from faster_whisper import WhisperModel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small.en")
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(args.input, beam_size=5, word_timestamps=True, vad_filter=True)
    text_parts = []
    words = []
    for segment in segments:
        text_parts.append(segment.text.strip())
        for word in segment.words or []:
            words.append({"word": word.word.strip(), "start": word.start, "end": word.end, "probability": word.probability})
    payload = {
        "language": info.language,
        "language_probability": info.language_probability,
        "text": " ".join(part for part in text_parts if part).strip(),
        "words": words,
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
