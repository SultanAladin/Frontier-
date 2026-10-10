#!/usr/bin/env python3
import pathlib, html, re
src = pathlib.Path("/home/user/Frontier-/CLAUDE.md").read_text(encoding="utf-8")
out = pathlib.Path("/home/user/Frontier-/VisualProof/CLAUDE_Rendered/index.html")
out.parent.mkdir(parents=True, exist_ok=True)

# very small markdown → html: headings, hr, tables, bullet, code, bold
def md_to_html(md):
    lines = md.splitlines()
    html_lines = []
    in_table = False
    in_list = False
    in_code = False
    table_head = True
    for line in lines:
        # code fences
        if line.strip().startswith("```"):
            if not in_code:
                html_lines.append('<pre><code>')
                in_code = True
            else:
                html_lines.append('</code></pre>')
                in_code = False
            continue
        if in_code:
            html_lines.append(html.escape(line))
            continue
        if re.match(r'^\s*---\s*$', line):
            if in_list:
                html_lines.append('</ul>'); in_list=False
            if in_table:
                html_lines.append('</tbody></table>'); in_table=False
            html_lines.append('<hr>')
            continue
        # headings
        m = re.match(r'^(#{1,3})\s+(.*)', line)
        if m:
            if in_list:
                html_lines.append('</ul>'); in_list=False
            if in_table:
                html_lines.append('</tbody></table>'); in_table=False
            level = len(m.group(1))
            text = m.group(2).strip()
            # keep emoji as is (whitelisted only)
            tag = f'h{level}'
            html_lines.append(f'<{tag}>{html.escape(text)}</{tag}>')
            continue
        # table row
        if '|' in line and line.strip().startswith('|'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            # separator row
            if all(re.match(r'^[\s:-]+$', c) for c in cells):
                continue
            if not in_table:
                html_lines.append('<table><thead><tr>')
                for c in cells:
                    html_lines.append(f'<th>{html.escape(c)}</th>')
                html_lines.append('</tr></thead><tbody>')
                in_table = True
            else:
                html_lines.append('<tr>')
                for c in cells:
                    # allow inline code
                    c = re.sub(r'`([^`]+)`', r'<code>\1</code>', html.escape(c))
                    html_lines.append(f'<td>{c}</td>')
                html_lines.append('</tr>')
            continue
        else:
            if in_table:
                html_lines.append('</tbody></table>')
                in_table=False
        # bullets
        if re.match(r'^\s*-\s+', line):
            if not in_list:
                html_lines.append('<ul>')
                in_list=True
            text = re.sub(r'^\s*-\s+', '', line)
            text = html.escape(text)
            text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
            text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
            text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
            html_lines.append(f'<li>{text}</li>')
            continue
        else:
            if in_list:
                html_lines.append('</ul>')
                in_list=False
        if line.strip()=='':
            continue
        # paragraph
        text = html.escape(line)
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
        html_lines.append(f'<p>{text}</p>')
    if in_list:
        html_lines.append('</ul>')
    if in_table:
        html_lines.append('</tbody></table>')
    return '\n'.join(html_lines)

body = md_to_html(src)
html_doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CLAUDE.md — rendered (live repo)</title>
<style>
  body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; max-width:860px; margin:32px auto; padding:0 20px; line-height:1.6; color:#1e1e1e; background:#fff}}
  h1{{font-size:26px; border-bottom:3px solid #111; padding-bottom:8px; margin-top:0}}
  h2{{font-size:18px; margin-top:28px; color:#2c3e50; border-left:4px solid #3498db; padding-left:10px; background:#f8fafc; padding-top:6px; padding-bottom:6px}}
  h3{{font-size:15px; margin-top:20px; color:#34495e}}
  hr{{border:none; border-top:1px solid #e5e7eb; margin:24px 0}}
  code{{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; background:#f3f4f6; padding:1px 6px; border-radius:4px}}
  pre{{background:#0f172a; color:#e2e8f0; padding:14px; border-radius:8px; overflow:auto}}
  pre code{{background:none; padding:0; color:inherit}}
  table{{border-collapse:collapse; width:100%; margin:12px 0; font-size:13px}}
  th,td{{border:1px solid #d1d5db; padding:8px 10px; text-align:left}}
  th{{background:#1f2937; color:#fff}}
  tr:nth-child(even) td{{background:#f9fafb}}
  ul{{margin:8px 0; padding-left:22px}}
  li{{margin:4px 0}}
  a{{color:#2563eb; text-decoration:none}} a:hover{{text-decoration:underline}}
  .badge{{display:inline-block; font-size:11px; padding:3px 8px; border-radius:999px; background:#e0f2fe; color:#0369a1; font-weight:700; vertical-align:middle; margin-left:8px}}
  .note{{background:#fefce8; border:1px solid #fde68a; padding:10px 12px; border-radius:8px; font-size:13px; margin:16px 0}}
  .header-meta{{color:#64748b; font-size:13px; margin-top:-8px; margin-bottom:18px}}
</style>
</head>
<body>
<p class="header-meta">Source: <code>CLAUDE.md</code> @ <code>/home/user/Frontier-</code> — live file, not stale Exhibits  •  Rendered {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M %Z')}  •  Exhibits/Gallery/* are from prior agents and are stale</p>
<h1>Slate — Agent Instructions <span class="badge">live render</span></h1>
{body}
<div class="note">📝 <strong>Render note (SLATE):</strong> This HTML is the live <code>CLAUDE.md</code> rendered for visual proof. Stale artefacts remain in <code>Exhibits/Gallery/</code> and <code>Exhibits/Workbench/</code> from previous agents — they are <strong>not</strong> the authority. The source of truth is this file at repo root. Formatting here follows <code>AgenticInstuctions/SKILL-Formatting.md</code> §8 (120-char wrap, bullet <code>-</code>, tables column-aligned) and emoji whitelist (only 📦 📝 💡 ⚠️ 🔴 🐞 🧵 ⏱️ etc.).</div>
<footer style="margin-top:32px; font-size:12px; color:#94a3b8; border-top:1px solid #e5e7eb; padding-top:10px">Generated by Tools/RenderClaude.py — does not write to _AgentScratch (deliverable, not scratch). VisualProof/CLAUDE_Rendered/index.html</footer>
</body>
</html>
"""
out.write_text(html_doc, encoding="utf-8")
print(f"wrote {out}")
