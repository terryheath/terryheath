<?php
/**
 * Boot task: the text Terry supplied (2026-11-20) for the Start here page and the White Rabbit issue line, written to each site's "Site text" settings.
 * Set only when the box is still empty, so anything edited later in the dashboard stays.
 */
if (!is_multisite()) { return; }
$fill = [
  'inkhorn.press' => [
    'start.p_welcome' => 'You don’t need to know anything about poetry to read it. Pick a short poem, read it aloud, then read it again. If a line stays with you, the poem is working.',
    'start.p_poetry' => 'Most of our poems use form: meter, rhyme and patterns like the sonnet. They’re written to be heard, and most fit on one screen.',
    'start.p_prose' => 'Stories and essays, from flash pieces of a few hundred words to the occasional long story.',
    'start.p_art' => 'Paintings, drawings and prints in traditional media, shown alongside the writing in each issue.',
    'start.poem_1' => '<a href="https://inkhornreview.com/review/flaco-the-eurasian-eagle-owl-march-15-2010-february-23-2023/">Flaco, the Eurasian Eagle-Owl</a>, by LindaAnn LoSchiavo. Listen for the steady ten-syllable line: it is blank verse, unrhymed iambic pentameter, and the beat holds while the story turns toward freedom.',
    'start.poem_2' => '<a href="https://inkhornreview.com/review/jean-jacket/">Jean-Jacket</a>, by Hibah Shabkhez. Listen for the rhymes that tie the first stanza together: awe and saw, rag and sag, ripping and nipping, spill and chill.',
    'start.poem_3' => '<a href="https://inkhornreview.com/review/yom-kippur-haiku/">Yom Kippur haiku</a>, by Gerard Sarnat. Listen for the three short beats and the pause at the dash: the whole poem fits in one breath.',
  ],
  'whiterabbitreview.com' => [
    'soon.issue_line' => 'The first issue: weird poetry, short prose and art.',
  ],
];
foreach (get_sites(['number' => 100]) as $s) {
  if (empty($fill[$s->domain]) || ($s->domain === 'inkhorn.press' && $s->path !== '/')) { continue; }
  switch_to_blog($s->blog_id);
  $o = get_option('ih_site_text', []); if (!is_array($o)) { $o = []; }
  $n = 0;
  foreach ($fill[$s->domain] as $k => $v) { if (!isset($o[$k]) || trim((string) $o[$k]) === '') { $o[$k] = $v; $n++; } }
  if ($n) { update_option('ih_site_text', $o, false); delete_site_transient('ih_text_registry'); echo "[inkhorn] placeholders: $n texts set on {$s->domain}\n"; }
  restore_current_blog();
}
