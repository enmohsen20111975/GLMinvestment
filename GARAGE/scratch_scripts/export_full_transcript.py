import json
import os
import re

transcript_path = r'C:\Users\DELL\.gemini\antigravity-ide\brain\f1c46b67-05dd-4f09-86df-fe75cd3e66a9\.system_generated\logs\transcript_full.jsonl'
artifact_output = r'C:\Users\DELL\.gemini\antigravity-ide\brain\f1c46b67-05dd-4f09-86df-fe75cd3e66a9\FULL_SESSION_TRANSCRIPT.md'
wsl_output = r'\\wsl.localhost\Ubuntu\home\meme\my_apps\GLMinvestment\Documentation\FULL_SESSION_TRANSCRIPT.md'

output_lines = [
    "# 📜 التفريغ الكامل والشامل لجلسة العمل والمحادثة (Full Session Transcript)",
    "**المشروع:** منصة دليل الاستثمار والتحليل الكمي — GLMinvestment",
    "**المالك:** الأستاذ محسن",
    "**معرّف الجلسة (Conversation ID):** `f1c46b67-05dd-4f09-86df-fe75cd3e66a9`",
    "**التاريخ:** 12 أكتوبر 2026",
    "",
    "---",
    "",
]

user_msg_idx = 1
assistant_msg_idx = 1

with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            step = json.loads(line)
            step_type = step.get('type')
            source = step.get('source', '')
            content = step.get('content', '')
            timestamp = step.get('timestamp', '')
            
            # User message
            if step_type == 'USER_INPUT' or source == 'USER_EXPLICIT':
                # Strip user tags like <USER_REQUEST> if present
                clean_content = content
                m = re.search(r'<USER_REQUEST>(.*?)</USER_REQUEST>', content, re.DOTALL)
                if m:
                    clean_content = m.group(1).strip()
                elif '<SYSTEM_MESSAGE>' in clean_content:
                    continue  # skip internal system messages
                
                output_lines.append(f"## 👤 [الأستاذ محسن — رسالة رقم {user_msg_idx}]")
                if timestamp:
                    output_lines.append(f"⏱️ *الوقت: {timestamp}*")
                output_lines.append("")
                output_lines.append(clean_content)
                output_lines.append("")
                output_lines.append("---")
                output_lines.append("")
                user_msg_idx += 1
                
            # Model response
            elif (step_type == 'PLANNER_RESPONSE' or source == 'MODEL') and content:
                # Filter out pure JSON or internal tool outputs
                if content.startswith('{') and content.endswith('}'):
                    continue
                output_lines.append(f"## 🤖 [المدير العام / Antigravity AI — رد رقم {assistant_msg_idx}]")
                if timestamp:
                    output_lines.append(f"⏱️ *الوقت: {timestamp}*")
                output_lines.append("")
                output_lines.append(content)
                output_lines.append("")
                output_lines.append("---")
                output_lines.append("")
                assistant_msg_idx += 1
                
        except Exception as e:
            continue

full_text = '\n'.join(output_lines)

# Write to artifact directory
try:
    with open(artifact_output, 'w', encoding='utf-8') as f:
        f.write(full_text)
    print(f"Artifact transcript written to {artifact_output}")
except Exception as e:
    print(f"Artifact write error: {e}")

# Write to WSL Documentation folder
try:
    os.makedirs(os.path.dirname(wsl_output), exist_ok=True)
    with open(wsl_output, 'w', encoding='utf-8') as f:
        f.write(full_text)
    print(f"WSL Documentation transcript written to {wsl_output}")
except Exception as e:
    print(f"WSL write error: {e}")

print(f"Done! Extracted {user_msg_idx - 1} User requests and {assistant_msg_idx - 1} AI responses.")
