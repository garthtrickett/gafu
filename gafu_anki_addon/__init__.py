import sys
sys.path.append("/home/user/files/code/gafu/lib/python3.11/site-packages")

from aqt import mw
from aqt.qt import *
from aqt.utils import showInfo
import subprocess
import pprint
import re
from anki.hooks import addHook
from gafu_anki_addon import ichiran
from pykakasi import kakasi
import requests
from bs4 import BeautifulSoup
from gafu_anki_addon import reading
from gafu_anki_addon import config

mecab  = reading.MecabController()
# Things to build
# sentence generator as a button in the card editor
# combine below code with gpt api to generate furigana and hover lookup for asbplayer
# generate dictionary frequency list using morphman on anime I want to watch then use that to have star ratings on words like in migaku



def copy_morph_to_morphfurigana():
    deck = mw.col.decks.current()
    card_ids = mw.col.db.list("select id from cards where did=?", deck['id'])
    for card_id in card_ids:
        card = mw.col.getCard(card_id)
        note = card.note()
        if 'Morph' in note and 'MorphFurigana' in note:
            morph_with_furigana = mecab.reading(note['Morph']) 
            note['MorphFurigana'] = morph_with_furigana
            note.flush()

action = QAction("Copy Morph to MorphFurigana", mw)
action.triggered.connect(copy_morph_to_morphfurigana)
mw.form.menuTools.addAction(action)


def sentence_to_sentencefurigana():
    deck = mw.col.decks.current()
    card_ids = mw.col.db.list("select id from cards where did=?", deck['id'])
    for card_id in card_ids:
        card = mw.col.getCard(card_id)
        note = card.note()
        if 'Sentence' in note and 'SentenceFurigana' in note:
            sentence_with_furigana = mecab.reading(note['Sentence']) 
            note['SentenceFurigana'] = sentence_with_furigana
            note.flush()

action = QAction("Generate SentenceFurigana from Sentence", mw)
action.triggered.connect(sentence_to_sentencefurigana)
mw.form.menuTools.addAction(action)

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

addHook("profileLoaded", lambda: mw.form.menuTools.addAction("Remove Duplicates MorphAudio", on_my_addon))



def get_sentences_for_word_from_massif(word):
    url = 'https://massif.la/ja/search?q="' + word + '"'
    response = requests.get(url)
    soup = BeautifulSoup(response.text, 'html.parser')

    li_elements = soup.find_all('li', class_='text-japanese')
    sentences = []

    count = 0
    for li in li_elements:
        # Get the text from the first div element inside the li element
        text = li.div.text
        # Check if the text has less than 15 characters
        if len(text) < 16:
            # Check if the first character of the text is not the same as the first character of any of the strings in sentences
            if not any(text[0] == sentence[0] for sentence in sentences):
                print(text)
                count += 1
                sentences.append(text)
                # Stop after printing the first 4 texts with less than 15 characters
                if count == 4:
                    break

    return sentences



def check_generated_sentence():
    # Get the collection
    col = mw.col
    # Get all the notes in the collection
    notes = col.find_notes("")
    for note_id in notes:
        note = col.get_note(note_id)
        # Check if the note has a GeneratedSentence field
        if "Sentence1" in note:
            # Check if the GeneratedSentence field is equal to x
            if note["Sentence1"] == "x":
                # Do something with the note
                print(note['Morph'])
                sentences = get_sentences_for_word_from_massif(note['Morph'])

                # Update the Anki note fields with the sentences
                for i, sentence in enumerate(sentences, 1):
                    field_name = f"Sentence{i}"
                    note[field_name] = mecab.reading(sentence)
                note.flush()
                    
                

def check_generated_sentence_action():
    # Replace x with the value you want to check for
    check_generated_sentence()
    showInfo("Done checking GeneratedSentence field")

# Create a new action
action = QAction("Check GeneratedSentence", mw)
# Set the action to run the check_generated_sentence_action function when triggered
action.triggered.connect(check_generated_sentence_action)
# Add the action to the Tools menu
mw.form.menuTools.addAction(action)

