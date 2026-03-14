import sys
import sqlite3
import shutil
import tempfile
import os

def main():
    if len(sys.argv) < 3:
        sys.exit(1)
        
    db_path = sys.argv[1]
    sql = sys.argv[2]
    
    tmp = None
    try:
        # Create a temp file to avoid WAL locks
        fd, tmp = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        shutil.copy2(db_path, tmp)
        
        # Connect to the temp db using built-in sqlite3 in read-only mode
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        
        # Set text factory to bytes or string to handle unicode safely
        conn.text_factory = str
        
        cur = conn.execute(sql)
        for row in cur.fetchall():
            # Output pipe-delimited strings to stdout for Node to parse
            print("|".join(str(x) if x is not None else "" for x in row))
            
        conn.close()
    except Exception as e:
        print(f"Error querying DB: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except:
                pass

if __name__ == "__main__":
    main()
