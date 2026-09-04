/* ==========================================================================
   種目アイコン(線画)
   写真やGIFではなく、著作権の心配がない自作の線画イラストで「その種目が
   どんな姿勢・動きなのか」を一目で伝える。stroke="currentColor" にしてある
   ので、ダークモードでも自動で色が馴染む。
   ========================================================================== */

(function () {
  const HEAD_R = 2.3;
  const DOT_R = 1.7;

  function head(cx, cy) {
    return `<circle cx="${cx}" cy="${cy}" r="${HEAD_R}"/>`;
  }
  function line(x1, y1, x2, y2, extra = "") {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
  }
  function dot(cx, cy, r = DOT_R) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  }
  // バーベル(棒+両端のプレート)
  function bar(x1, y1, x2, y2) {
    return line(x1, y1, x2, y2) + dot(x1, y1) + dot(x2, y2);
  }
  function rect(x, y, w, h, rx = 1.2) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
  }
  function ground(x1 = 4, x2 = 28) {
    return line(x1, 27.5, x2, 27.5, 'stroke-width="1.5" opacity="0.35"');
  }
  function icon(shapes) {
    return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
  }

  const EXERCISE_ICONS = {
    // ---- 胸 ----
    "ベンチプレス": icon(
      rect(6, 23, 20, 2) +
      line(11, 23, 8, 27) + line(8, 27, 12, 27) +
      line(11, 21, 21, 21) +
      head(23, 21) +
      line(15, 21, 15, 10) +
      bar(8, 10, 22, 10)
    ),
    "インクラインベンチプレス": icon(
      line(6, 27, 20, 15, 'stroke-width="3"') +
      line(9, 24.5, 17, 18) +
      head(19, 16) +
      line(9, 24.5, 6, 28) +
      line(14, 20, 14, 9) +
      bar(7, 9, 21, 9)
    ),
    "ダンベルフライ": icon(
      rect(6, 23, 20, 2) +
      line(11, 23, 8, 27) + line(8, 27, 12, 27) +
      line(11, 21, 21, 21) +
      head(23, 21) +
      line(15, 21, 7, 16) + line(15, 21, 23, 16) +
      dot(7, 16) + dot(23, 16)
    ),
    "腕立て伏せ(プッシュアップ)": icon(
      ground() +
      head(23, 10) +
      line(21, 12, 10, 19) +
      line(21, 12, 21, 22) +
      line(10, 19, 6, 22)
    ),
    // ---- 背中 ----
    "デッドリフト": icon(
      ground() +
      head(12, 9) +
      line(12, 11, 20, 17) +
      line(20, 17, 19, 26) +
      line(15, 13, 15, 24) +
      bar(9, 24, 21, 24)
    ),
    "懸垂(チンニング)": icon(
      line(6, 7, 26, 7, 'stroke-width="2.6"') +
      line(11, 7, 14, 16) + line(21, 7, 18, 16) +
      head(16, 18) +
      line(16, 20, 16, 25) +
      line(16, 25, 13, 29)
    ),
    "ラットプルダウン": icon(
      line(9, 27, 23, 27, 'stroke-width="2.6"') +
      line(16, 26, 16, 17) +
      head(16, 15) +
      line(16, 20, 9, 13) + line(16, 20, 23, 13) +
      bar(7, 12, 25, 12)
    ),
    "ベントオーバーロウ": icon(
      ground() +
      head(10, 10) +
      line(10, 12, 19, 18) +
      line(19, 18, 18, 27) +
      line(13, 14, 16, 21) +
      bar(9, 21, 21, 21)
    ),
    "ダンベルロウ": icon(
      rect(4, 24, 10, 2) +
      line(9, 24, 9, 18) +
      line(9, 18, 21, 21) +
      head(22, 21) +
      line(12, 19, 9, 24) +
      line(16, 19, 19, 13) +
      dot(19, 12)
    ),
    // ---- 脚 ----
    "スクワット": icon(
      ground() +
      head(16, 9) +
      line(16, 11, 16, 17) +
      line(16, 17, 11, 21) + line(11, 21, 12, 27) +
      line(16, 17, 21, 21) + line(21, 21, 20, 27) +
      bar(9, 11, 23, 11)
    ),
    "レッグプレス": icon(
      line(6, 10, 6, 26, 'stroke-width="2.6"') +
      head(11, 22) +
      line(11, 24, 18, 21) +
      line(18, 21, 24, 21) + line(18, 21, 22, 14) +
      line(24, 10, 24, 21, 'stroke-width="2.6"')
    ),
    "レッグエクステンション": icon(
      rect(6, 21, 14, 2) +
      head(11, 12) +
      line(11, 14, 11, 21) +
      line(20, 21, 20, 15) +
      line(20, 21, 26, 17) +
      dot(26, 17, 1.5)
    ),
    "レッグカール": icon(
      rect(6, 19, 16, 2) +
      head(23, 17) +
      line(21, 19, 11, 19) +
      line(11, 19, 11, 26) +
      line(11, 26, 16, 22) +
      dot(16, 22, 1.4)
    ),
    "ランジ": icon(
      ground() +
      head(15, 9) +
      line(15, 11, 15, 17) +
      line(15, 17, 20, 20) + line(20, 20, 20, 27) +
      line(15, 17, 10, 22) + line(10, 22, 15, 25)
    ),
    "カーフレイズ": icon(
      ground() +
      head(16, 8) +
      line(16, 10, 16, 20) +
      line(16, 20, 13, 27) + line(16, 20, 19, 27) +
      line(12, 27, 14, 25) + line(18, 27, 20, 25)
    ),
    // ---- 肩 ----
    "ショルダープレス": icon(
      ground() +
      head(16, 9) +
      line(16, 11, 16, 21) +
      line(16, 21, 13, 27) + line(16, 21, 19, 27) +
      line(16, 13, 10, 8) + dot(9, 7) +
      line(16, 13, 22, 8) + dot(23, 7)
    ),
    "サイドレイズ": icon(
      ground() +
      head(16, 9) +
      line(16, 11, 16, 21) +
      line(16, 21, 13, 27) + line(16, 21, 19, 27) +
      line(16, 13, 8, 12) + dot(7, 12) +
      line(16, 13, 24, 12) + dot(25, 12)
    ),
    "リアレイズ": icon(
      ground() +
      head(10, 11) +
      line(10, 13, 18, 18) +
      line(18, 18, 17, 27) +
      line(13, 15, 7, 12) + dot(6, 12) +
      line(13, 15, 19, 12) + dot(20, 12)
    ),
    // ---- 腕 ----
    "アームカール(バイセップスカール)": icon(
      ground() +
      head(16, 9) +
      line(16, 11, 16, 21) +
      line(16, 21, 13, 27) + line(16, 21, 19, 27) +
      line(16, 13, 20, 18) + line(20, 18, 17, 11) +
      dot(17, 11)
    ),
    "トライセプスエクステンション": icon(
      ground() +
      head(16, 9) +
      line(16, 11, 16, 21) +
      line(16, 21, 13, 27) + line(16, 21, 19, 27) +
      line(17, 12, 21, 8) + line(21, 8, 21, 15) +
      dot(21, 15)
    ),
    "ディップス": icon(
      line(6, 10, 6, 25, 'stroke-width="2.4"') + line(24, 10, 24, 25, 'stroke-width="2.4"') +
      head(15, 11) +
      line(15, 13, 15, 21) +
      line(9, 15, 15, 17) + line(21, 15, 15, 17) +
      line(15, 21, 12, 26) + line(15, 21, 18, 26)
    ),
    // ---- 体幹・腹筋 ----
    "プランク": icon(
      ground() +
      head(24, 15) +
      line(22, 16, 9, 21) +
      line(9, 21, 9, 26) +
      line(22, 16, 22, 22)
    ),
    "クランチ(腹筋)": icon(
      ground() +
      line(6, 24, 12, 24) + line(12, 24, 12, 19) +
      line(6, 24, 16, 24) +
      line(16, 24, 22, 19) +
      head(24, 17)
    ),
    "レッグレイズ": icon(
      ground() +
      head(22, 24) +
      line(20, 24, 11, 24) +
      line(11, 24, 11, 9)
    ),
  };

  // 自由入力(その他)用のアイコン: 種目未定なので「＋」で表現
  const EXERCISE_ICON_CUSTOM = icon(
    line(16, 9, 16, 23, 'stroke-width="2.6"') + line(9, 16, 23, 16, 'stroke-width="2.6"')
  );

  window.EXERCISE_ICONS = EXERCISE_ICONS;
  window.EXERCISE_ICON_CUSTOM = EXERCISE_ICON_CUSTOM;
})();
