import sys

from aqt import mw
from aqt.qt import *
from aqt.utils import showInfo
import subprocess
import pprint
import re
from anki.hooks import addHook
from gafu_anki_addon import ichiran
# Things to build
# sentence generator as a button in the card editor
# combine below code with gpt api to generate furigana and hover lookup for asbplayer
# generate dictionary frequency list using morphman on anime I want to watch then use that to have star ratings on words like in migaku




def filter_sound_field(field):
    kakasi_converter = kakasi()
    kakasi_converter.setMode('H', 'K')
    kakasi_converter.setMode('J', 'K')    
    converter = kakasi_converter.getConverter()
    
    pattern = r'\[sound:(.+?)\]'
    matches = re.findall(pattern, field)
    result = None
    for match in matches:
        parts = match.split('_')
        hiragana = parts[0]
        katakana = parts[1].replace('＼', '').replace('━', '')

        hiragana_to_katakana = converter.do(hiragana)
        if hiragana_to_katakana == katakana:
            result = f'[sound:{match}]'
            break

    return ''.join(result) if result else field


def update_morph_audio():
    # Get all notes that have a MorphAudio field
    notes = mw.col.findNotes("MorphAudio:*")
    for note_id in notes:
        note = mw.col.getNote(note_id)
        # Update the MorphAudio field
        note['MorphAudio'] = filter_sound_field(note['MorphAudio'])
        note.flush()
    showInfo(f"Updated {len(notes)} notes")

def on_my_addon():
    update_morph_audio()

addHook("profileLoaded", lambda: mw.form.menuTools.addAction("Update MorphAudio", on_my_addon))


def print_generated_sentence():
    # Get all notes that have a GeneratedSentence field
    notes = mw.col.findNotes("GeneratedSentence:*")
    for note_id in notes:
        note = mw.col.getNote(note_id)
        # Check if the GeneratedSentence field is not empty
        if note['GeneratedSentence']:
            chat = ChatOpenAI(
            model="gpt-3.5-turbo",
            openai_api_key=openai_api_key,
            )

            prompt =  "Write a japanese sentence that contains the word " + note['Morph'] + " where the other words in the sentence help the reader guess what the 海豚 means. Output only the japanese sentence no explanation" 


            messages = [
                HumanMessage(content=prompt),
            ]
            chat_result = chat(messages)
            print(chat_result.content) 
            #  cmd = ['docker', 'exec', '-it', 'ichiran-main-1', 'ichiran-cli', '-i', subs_list[0]]
            # result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            # kanji_with_furigana_array = ichiran.ichiran_output_to_bracket_furigana(result,  subs_list[0])
            # kanji_with_furigana_string = ''.join(kanji_with_furigana_array)
            # kanji_with_furigana_csv = ', '.join(f'"{item}"' for item in kanji_with_furigana_array)
            # print(kanji_with_furigana_array)

def on_print_generated_sentence():
    print_generated_sentence()

addHook("profileLoaded", lambda: mw.form.menuTools.addAction("Print GeneratedSentence", on_print_generated_sentence))
