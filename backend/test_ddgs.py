from ddgs import DDGS

def _search():
    with DDGS() as ddgs:
        results = list(ddgs.text("Cape Town weather today", max_results=5))
        return results

if __name__ == "__main__":
    try:
        print("Testing DDGS...")
        r = _search()
        print("Results:")
        for res in r:
            print(res)
    except Exception as e:
        print(f"Error: {e}")
