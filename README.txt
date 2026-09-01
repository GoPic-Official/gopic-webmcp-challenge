GoPic WebMCP Speed Tune v2

Changes:
- Browser resizes uploaded images to max 1400px on the long side.
- Browser converts analysis upload to JPEG quality 0.85.
- Original photo remains visible in the preview.
- Analysis upload is typically much smaller/faster.
- Gemini response is capped at 2 candidates.
- Candidate reasons are requested at 15 words or fewer.
- Loading text shows Reading / Matching / Verifying.
- Fixed the upload prompt text overlay after selecting a photo.
- analyze.php permanently supports /home/u599982929/.gopic_gemini_api_key.

Deploy these three files:
index.html
assets/css/app.css
api/analyze.php
