from aqt import mw
from aqt.qt import *
from aqt.utils import showInfo
import sys
from gafu_anki_addon import reading
from gafu_anki_addon import config
import subprocess
import pprint
import re




print("path")
print(sys.path)

mecab  = reading.MecabController()

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




def remove_compound_words(strings: list) -> list:
    result = []
    for s in strings:
        if 'Compound word' in s:
            index = s.index('Compound word')
            result.append(s[:index].rstrip())
        else:
            result.append(s)
    return result

# would also be good to figure out the rules for the spacing so that theres no gaps in kanji but furigana display properly

def ichiran_output_to_kanji_hirigana_array(result):

    lines = result.stdout.splitlines()
    star_lines = [line for line in lines if line.startswith('*')]

    star_lines = remove_compound_words(star_lines)

    star_lines = [re.sub(r'(?<=【)[^】]*', lambda x: x.group().replace(' ', ''), s) for s in star_lines]
    new_list = []
    for string in star_lines:
        if '【' in string:
            split_string = string.split()
            index = split_string.index([word for word in split_string if '【' in word][0])
            new_list.append(split_string[index-1] + ' ' + split_string[index])
        else:
            new_list.append(string.split()[-1])

    new_list = [item.replace('【', '[').replace('】', ']') for item in new_list]
    return new_list


def add_leading_spaces_from_sentence(new_list, japanese):
    output = []
    for word in new_list:
        if "[" in word:
            index = word.index("[")
            word_outside_brackets = word[:index].strip()
        else:
            word_outside_brackets = word
        if " " + word_outside_brackets in japanese:
            output.append(" " + word)
        if word_outside_brackets + "、" in japanese:
            output.append(word + "、")
        else:
            output.append(word)
    print(output)
    return output


def add_furigana(s: str) -> str:
    if '[' not in s or ']' not in s:
        return s
    outside, inside = s.split('[')
    inside = inside.split(']')[0]
    outside = outside.strip()
    inside = inside.strip()
    n = min(len(outside), len(inside))
    common_start = 0
    common_end = 0
    for i in range(n):
        if outside[i] == inside[i]:
            common_start += 1
        else:
            break
    for i in range(n):
        if outside[-i-1] == inside[-i-1]:
            common_end += 1
        else:
            break
    if common_start == 0 and common_end == 0:
        return ' ' + s.replace(' ', '')
    elif common_start > 0:
        return f" {outside}[{inside[common_start:]}]"
    else:
        return f" {outside[:len(outside)-common_end]}[{inside[:len(inside)-common_end]}]{outside[len(outside)-common_end:]}"

def process_kanji_hirigana_into_kanji_with_furigana(new_list):
    result_list = [add_furigana(item) for item in new_list]
    return result_list


def ichiran_output_to_bracket_furigana(ichiran_output, japanese):
    new_list = ichiran_output_to_kanji_hirigana_array(ichiran_output)
    new_list = add_leading_spaces_from_sentence(new_list, japanese)
    kanji_with_furigana = process_kanji_hirigana_into_kanji_with_furigana(new_list)
    return kanji_with_furigana


japanese = "昨日、ひょんなことで父親の戸籍抄本のコピーを見てしまいました。"
cmd = ['docker', 'exec', '-it', 'ichiran-main-1', 'ichiran-cli', '-i', japanese]
result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
kanji_with_furigana_array = ichiran_output_to_bracket_furigana(result,  japanese)
print(kanji_with_furigana_array)
kanji_with_furigana_string = ''.join(kanji_with_furigana_array)
print(kanji_with_furigana_string)





