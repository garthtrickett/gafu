from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain.chat_models import ChatOpenAI
from langchain.schema import AIMessage, HumanMessage, SystemMessage
import pprint
import subprocess
import os
from dotenv import load_dotenv

load_dotenv()

pp = pprint.PrettyPrinter(indent=4)

openai_api_key = os.getenv("OPENAI_API_KEY")

chat = ChatOpenAI(
    model="gpt-3.5-turbo",
    openai_api_key=openai_api_key,
)


class InputString(BaseModel):
    input_string: str


class FuriganaInput(BaseModel):
    text: str


app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)


@app.post("/append")
async def append_string(input: InputString):
    prompt_part_one = "Task: tokenize:"
    prompt_part_two = 'reply to me with no explanation only a single lined comma seperate string such that each token is 3 values "token","part of speech (in english). for example noun" "meaning", "token_word2"...'

    prompt = prompt_part_one + input.input_string + prompt_part_two

    messages = [
        SystemMessage(
            content="You are a helpful assistant that translates back and forth between English and Japanese."
        ),
        HumanMessage(content=prompt),
    ]
    chat_result = chat(messages)
    pp.pprint(chat_result.content)
    return {"appended_string": chat_result}


@app.post("/furigana")
async def generate_furigana(input: FuriganaInput):
    mecab = MeCab.Tagger("-Oyomi")
    furigana = mecab.parse(input.text).strip()
    return {"furigana": furigana}

class IchiranInput(BaseModel):
    sentence: str

@app.post("/send_to_ichiran")
async def send_to_ichiran(input: IchiranInput):
    cmd = ['docker', 'exec', '-it', 'ichiran-main-1', 'ichiran-cli', '-i', input.sentence]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    return {"result": result.stdout}
