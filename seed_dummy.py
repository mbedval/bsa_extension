import sqlite3
import pandas as pd
import numpy as np
import datetime
import os
from app import fetch_yahoo_range, evaluate_patterns_range

print("Seeding DUMMY data...")
fetch_yahoo_range('DUMMY', '1mo', 'india')
evaluate_patterns_range('DUMMY', '1mo', 'india')
print("Done seeding DUMMY.")
