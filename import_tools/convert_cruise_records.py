#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import logging
import os
import sys

# logging level
LOG_LEVEL = logging.INFO

# create logger
logger = logging.getLogger(__file__ )
logger.setLevel(LOG_LEVEL)

# create console handler and set level to debug
ch = logging.StreamHandler()
ch.setLevel(LOG_LEVEL)

# create formatter
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# add formatter to ch
ch.setFormatter(formatter)

# add ch to logger
logger.addHandler(ch)

def convertCruiseRecord(cruise_record_fn):
    with open(cruise_record_fn) as cruise_record_fp:
        cruises = json.load(cruise_record_fp)

        return_cruises = []

        if isinstance(cruises, (list,)):

            for cruise in cruises:
                try:
                    logger.debug("Processing Cruise: " + cruise['cruise_id'])
                    cruiseOBJ = {
                        '_id': {"$oid": cruise['id']},
                        'cruise_id': cruise['cruise_id'],
                        'start_ts': {"$date": cruise['start_ts']},
                        'stop_ts': {"$date": cruise['stop_ts']},
                        'cruise_location': cruise['cruise_location'],
                        'cruise_pi': cruise['cruise_pi'],
                        'cruise_tags': cruise['cruise_tags'],
                        'cruise_hidden': cruise['cruise_hidden'],
                        'cruise_access_list': [],
                        'cruise_additional_meta': {
                            'cruise_name': cruise['cruise_name'],
                            'cruise_vessel': "",
                            'cruise_description': cruise['cruise_description'],
                            'cruise_participants': [],
                            'cruise_files': []
                        }
                    }
                    return_cruises.append(cruiseOBJ)
                except Exception as e:
                    logger.error("issue at: " + cruise['cruise_id'])
                    logger.error(e)
                    return None
        else:
            cruiseOBJ = {
                '_id': {"$oid": cruises['id']},
                'cruise_id': cruises['cruise_id'],
                'start_ts': {"$date": cruises['start_ts']},
                'stop_ts': {"$date": cruises['stop_ts']},
                'cruise_location': cruises['cruise_location'],
                'cruise_pi': cruises['cruise_pi'],
                'cruise_tags': cruises['cruise_tags'],
                'cruise_hidden': cruises['cruise_hidden'],
                'cruise_access_list': [],
                'cruise_additional_meta': {
                    'cruise_name': cruises['cruise_name'],
                    'cruise_vessel': "",
                    'cruise_description': cruises['cruise_description'],
                    'cruise_participants': [],
                    'cruise_files': []
                }
            }
            return_cruises.append(cruiseOBJ)

        return return_cruises


if __name__ == '__main__':

    import argparse

    parser = argparse.ArgumentParser(description='cruise record reformatter')
    parser.add_argument('-d', '--debug', action='store_true', help=' display debug messages')
    parser.add_argument('cruise_record_file', help=' original cruise record to reformat')

    args = parser.parse_args()

    # Turn on debug mode
    if args.debug:
        logger.info("Setting log level to DEBUG")
        logger.setLevel(logging.DEBUG)
    
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    if not os.path.isfile(args.cruise_record_file):
        logger.error(args.cruise_record_file + " does not exist.")
        sys.exit(0)

    new_cruise_record = convertCruiseRecord(args.cruise_record_file)

    if(new_cruise_record):
        print(json.dumps(new_cruise_record, indent=2))
    else:
        logger.error("Nothing to return")
