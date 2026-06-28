import asyncio
import nodriver as uc
from bs4 import BeautifulSoup
import urllib.parse

async def search_google(query):
    browser = await uc.start(headless=True)
    try:
        url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"
        page = await browser.get(url)
        await asyncio.sleep(3)
        html = await page.get_content()
        soup = BeautifulSoup(html, "html.parser")
        
        results = []
        for g in soup.find_all("div", class_="g"):
            a_tag = g.find("a")
            title_tag = g.find("h3")
            if a_tag and title_tag:
                link = a_tag["href"]
                title = title_tag.text
                results.append({"title": title, "link": link})
        print(results)
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(search_google("Cape Town weather today"))
