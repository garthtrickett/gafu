# -*- coding: utf-8 -*-

from aqt import mw
from anki.hooks import addHook
import random
import re
import urllib



def onShowQuestion():
    # Get the current card
    card = mw.reviewer.card
    note = card.note()

    # Define your field_name here
    field_name = "japanese_sentence_"

    # Get a list of all non-empty fields
    non_empty_fields = [field for field in note.keys() if field.startswith(field_name) and note[field]]

    selected_field = random.choice(non_empty_fields)

    # Extract the number after the underscore
    selected_field_number = int(selected_field.split('_')[-1])

    # Convert the field content to use ruby tags for furigana
    selectedFieldContent = note[selected_field]
    selectedFieldContent = re.sub(r'(\w+)\[(\w+)\]', r'<ruby>\1<rt>\2</rt></ruby>', selectedFieldContent)
    selectedFieldContent_safe_string = urllib.parse.quote(selectedFieldContent)

    # Get the corresponding audio and translation fields
    selectedAudioContent = note["audio_sentence_" + str(selected_field_number)]
    selectedTranslationContent = note["translation_sentence_" + str(selected_field_number)]
    selectedTranslationContent_safe_string = urllib.parse.quote(selectedTranslationContent)


    # Extract the audio URL from the audio content
    audio_url = re.search(r'\[sound:(.*?)\]', selectedAudioContent).group(1)


    print("mwstate: ")
    print(mw.state)

    # Generate JavaScript code to create new divs with the content of the selected fields
    js_code = """
        
    console.log("THIS RAN")

    // Cleanup function to remove existing elements
    function cleanup() {
        var existingElements = document.querySelectorAll('[id^="japanese_sentence_"], [id^="audio_sentence_"], [id^="translation_sentence_"]');
        for (var i = 0; i < existingElements.length; i++) {
            existingElements[i].parentNode.removeChild(existingElements[i]);
        }
    }

    // Call the cleanup function before creating new elements
    cleanup();
    var selectedFieldContent = decodeURIComponent('""" + selectedFieldContent_safe_string + """');
    var audioUrl = '""" + audio_url + """';
    var selectedTranslationContent = decodeURIComponent('""" + selectedTranslationContent_safe_string + """');


    var newDiv = document.createElement('div');
    newDiv.id = 'japanese_sentence_' + selected_field_number;
    newDiv.innerHTML = selectedFieldContent;
    document.body.appendChild(newDiv);

    var audioElement = document.createElement('audio');
    audioElement.id = 'audio_sentence_' + selected_field_number;
    audioElement.src = audioUrl;
    audioElement.controls = true;
    document.body.appendChild(audioElement);


    var translationDiv = document.createElement('div');
    translationDiv.id = 'translation_sentence_' + selected_field_number;
    translationDiv.innerHTML = selectedTranslationContent;
    translationDiv.style.display = 'none';  // This line hides the div
    document.body.appendChild(translationDiv);

    var gramDiv = document.getElementById('gram_id');

    // Hide the div
    if (gramDiv) {
        gramDiv.style.display = 'none';
    }
    """
    js_code = js_code.replace('selected_field_number', str(selected_field_number))

    # Execute the JavaScript code
    mw.web.eval(js_code)


addHook("showQuestion", onShowQuestion)


def onShowAnswer():
    # JavaScript code to show all divs with an id that starts with 'translation_sentence_'
    js_code = """
    var translationDivs = document.querySelectorAll('[id^="translation_sentence_"]');
    for (var i = 0; i < translationDivs.length; i++) {
        translationDivs[i].style.display = 'block';
    }

    
    var gramDiv = document.getElementById('gram_id');

    // Hide the div
    if (gramDiv) {
        gramDiv.style.display = 'none';
    }   
    """

    

    # Inject the JavaScript code
    mw.web.eval(js_code)


addHook("showAnswer", onShowAnswer)
