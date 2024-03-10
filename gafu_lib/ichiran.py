
import subprocess
import pprint
import re
pp = pprint.PrettyPrinter(indent=4)

def remove_compound_words(strings: list) -> list:
    result = []
    for s in strings:
        if 'Compound word' in s:
            index = s.index('Compound word')
            result.append(s[:index].rstrip())
        else:
            result.append(s)
    return result


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



def find_rule_end_positions(sentence, rules):
    rule_end_positions = []
    for rule in rules:
        rule_end = rule[-1]
        for i in range(len(sentence)):
            if sentence[i] == rule_end:
                rule_end_positions.append(i)
    return rule_end_positions

def find_grammar_rules(kanji_with_furigana_array, parts_of_speech_array, rules):
    rule_matches = []
    for rule in rules:
        rule_end = rule[-1]
        for i in range(1, len(kanji_with_furigana_array)):
            if kanji_with_furigana_array[i] == rule_end and parts_of_speech_array[i-1] in rule[:-1]:
                rule_matches.append(rule)
    return rule_matches


def extract_first_pos_tags(result):
    lines = result.stdout.splitlines()
    pos_tags = []

    for line in lines:
        if line.startswith('1.'):
            match = re.search(r'\[([a-z0-9]+)\]', line)
            if match:
                pos_tags.append(match.group(1))
        elif 'Conjugation' in line:
            match = re.search(r'\[([a-z0-9]+)\]', line)
            if match:
                pos_tags.append(match.group(1))
    return pos_tags


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
        elif word_outside_brackets + "、" in japanese:
            output.append(word + "、")
        else:
            output.append(word)
    return output


def add_furigana(s: str) -> str:
    if '[' not in s or ']' not in s:
        return s

    outside, inside = s.split('[')
    jap_comma_after_brackets = False
    if "、" in inside:
        jap_comma_after_brackets = True
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
        output = ' ' + s.replace(' ', '')
    elif common_start > 0:
        output = f" {outside}[{inside[common_start:]}]"
    else:
        output = f" {outside[:len(outside)-common_end]}[{inside[:len(inside)-common_end]}]{outside[len(outside)-common_end:]}"

    if jap_comma_after_brackets == True:
        output = output + "、"
    return output

def process_kanji_hirigana_into_kanji_with_furigana(new_list):
    result_list = [add_furigana(item) for item in new_list]
    return result_list


def ichiran_output_to_bracket_furigana(ichiran_output):
    new_list = ichiran_output_to_kanji_hirigana_array(ichiran_output)
    kanji_with_furigana = process_kanji_hirigana_into_kanji_with_furigana(new_list)
    return kanji_with_furigana







