import asyncio
import nodriver as uc
from bs4 import BeautifulSoup
import urllib.parse

async def search_ddg(query):
    browser = await uc.start(headless=True)
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        page = await browser.get(url)
        await asyncio.sleep(2)
        html = await page.get_content()
        soup = BeautifulSoup(html, "html.parser")
        
        results = []
        for a in soup.find_all("a", class_="result__url"):
            link = a.get("href")
            # find title in the result__title
            parent = a.find_parent("div", class_="result")
            if parent:
                title_tag = parent.find("a", class_="result__title")
                snippet_tag = parent.find("a", class_="result__snippet")
                if title_tag:
                    results.append({
                        "title": title_tag.text.strip(),
                        "link": link.strip() if link else "",
                        "snippet": snippet_tag.text.strip() if snippet_tag else ""
                    })
        print(f"Found {len(results)} results:")
        for r in results:
            print(r)
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(search_ddg("Cape Town weather today"))
