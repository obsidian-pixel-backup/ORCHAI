import asyncio
import nodriver as uc
from bs4 import BeautifulSoup
import time

async def search_google_typing(query):
    browser = await uc.start(headless=True)
    try:
        page = await browser.get('https://www.google.com')
        # Wait for page to load
        await asyncio.sleep(2)
        
        # Accept cookies if the button exists
        try:
            accept_button = await page.select('button:has-text("Accept all")')
            if accept_button:
                await accept_button.click()
                await asyncio.sleep(1)
        except:
            pass
            
        # Find search input (name="q")
        input_box = await page.select('textarea[name="q"]')
        if not input_box:
            input_box = await page.select('input[name="q"]')
            
        if input_box:
            await input_box.send_keys(query)
            await input_box.send_keys('\n')
            
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
            print(f"Found {len(results)} results:")
            for r in results:
                print(r)
        else:
            print("Could not find search box")
    finally:
        browser.stop()

if __name__ == "__main__":
    asyncio.run(search_google_typing("Cape Town weather today"))
