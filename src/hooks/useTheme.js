import { useEffect, useState } from "react";
import { currentTheme, subscribeTheme, toggleTheme } from "../lib/theme";

// Tema tinggal di luar React (atribut di elemen akar, dipasang skrip boot sebelum halaman dicat),
// jadi yang dilakukan hook ini cuma ikut mendengarkan — bukan memilikinya. Nilai awalnya dibaca
// dari keadaan yang SUDAH terpasang, supaya render pertama tidak pernah berbeda dari yang terlihat.
export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => subscribeTheme(setTheme), []);
  return { theme, toggleTheme };
}
