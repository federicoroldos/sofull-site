# Screenshots

Drop product screenshots here. The main `README.md` references the filenames
below — once the files exist, uncomment the screenshot table in the root README.

## Expected filenames

| Filename | What to capture | Suggested size |
| --- | --- | --- |
| `web-list.png` | Logged-in entry list with at least 4 entries covering multiple categories. Show the sort/category controls in the toolbar. | 1280 × 800 |
| `web-add.png` | The "Add Item" modal open with all fields visible (rating, attribute meter, upload button). | 1280 × 800 |
| `android.png` | The Android app on a device or emulator — same list view as `web-list.png`. | Portrait, ~390 × 844 |

## Tips

- Capture from a clean state (no error banners, no expired-session modal).
- Use the demo entries hardcoded in `App.tsx` if you want a reproducible
  logged-out shot — just sign out before capturing.
- Compress with `pngquant` or `oxipng` to keep the repo light. Aim for < 250 KB
  per image.
- Don't capture any real account email — sign in with a throwaway Google
  account or blur the email pill before saving.
