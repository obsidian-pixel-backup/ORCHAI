from googlesearch import search
try:
    results = list(search("Cape Town weather today", num_results=5, advanced=True))
    print(f"Results: {len(results)}")
    for r in results:
        print(dir(r))
        print(r.title, r.url, r.description)
except Exception as e:
    print("Error:", e)
