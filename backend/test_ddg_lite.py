import asyncio
import nodriver as uc
from bs4 import BeautifulSoup
import urllib.parse

async def search_ddg_lite(query):
    browser = await uc.start(headless=True)
    try:
        page = await browser.get('https://lite.duckduckgo.com/lite/')
        await asyncio.sleep(2)
        
        # find input box
        input_box = await page.select('input[name="q"]')
        if input_box:
            await input_box.send_keys(query)
            # click submit
            submit = await page.select('input[type="submit"]')
            if submit:
                await submit.click()
            else:
                await input_box.send_keys('\n')
            
            await asyncio.sleep(3)
            html = await page.get_content()
            soup = BeautifulSoup(html, "html.parser")
            
            results = []
            for tr in soup.find_all("tr"):
                a_tag = tr.find("a", class_="result-url")
                if not a_tag:
                    a_tag = tr.find("a", class_="result-snippet")
                if not a_tag:
                    # just find the first link inside a result-title class or anything that looks like a result
                    td = tr.find("td", class_="result-snippet")
                    if td:
                        pass # It's a snippet
                
                # Let's just find all 'a' tags with href that are not duckduckgo internal
                for a in tr.find_all("a"):
                    link = a.get("href")
                    if link and link.startswith("http") and "duckduckgo.com" not in link:
                        results.append({"title": a.text, "link": link})
                        
            print(f"Found {len(results)} results:")
            for r in results:
                print(r)
        else:
            print("Could not find search box")
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(search_ddg_lite("Cape Town weather today"))
