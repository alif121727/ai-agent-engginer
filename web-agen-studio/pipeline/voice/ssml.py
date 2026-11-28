"""Pembangun SSML: jeda, penekanan, dan laju bicara."""


def build(text: str, rate: str = "1.0", pitch: str = "+0st", pause_ms: int = 250,
          emphasis: str = None) -> str:
    isi = text
    if emphasis and emphasis.lower() in text.lower():
        idx = text.lower().index(emphasis.lower())
        sebelum, kata, sesudah = text[:idx], text[idx:idx + len(emphasis)], text[idx + len(emphasis):]
        isi = f'{sebelum}<emphasis level="moderate">{kata}</emphasis>{sesudah}'
    return (
        '<speak version="1.0" xml:lang="id-ID">'
        f'<prosody rate="{rate}" pitch="{pitch}" volume="medium">{isi}</prosody>'
        f'<break time="{pause_ms}ms"/>'
        "</speak>"
    )
