#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# Purpose: This script converts the suliusCam copy script exported by the at-
#          sea instance of Sealog so that it can be used to copy the SuliusCam
#          images to the appropriate location on the Shoreside Sealog Server 
#
#   Usage: convert_suliusCam_copy_script.py [-d] <loweringID> <original suliusCam copy script>
#
#  Author: Webb Pinner webbpinner@gmail.com
# Created: 2019-05-22

import json
import logging
import os
import sys
import copy

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

def modifyCopyScript(loweringID, copy_script_fn):

    newCopyScript = ''
    with open(copy_script_fn) as copy_script_fp:
        for line in copy_script_fp:

            if line.startswith('cp'):
            
                copy, verbose, sourceFilePath, destDir = line.split(' ')
                sourceFileName = sourceFilePath.split('/')[-1]
                new_destFilePath = os.path.join(loweringID, 'SuliusCam', 'SuliusCam.' + sourceFileName.split('_')[-1][:8] + "_" + sourceFileName.split('_')[-1][8:14] + '000' + sourceFileName.split('_')[-1][14:])
                newCopyScript += ' '.join([copy, verbose, '${SOURCE_DIR}/' + sourceFileName, '${DEST_DIR}/' + new_destFilePath, '\n'])

    return newCopyScript



if __name__ == '__main__':

    import argparse

    parser = argparse.ArgumentParser(description='suliusCam copy script tweaker')
    parser.add_argument('-d', '--debug', action='store_true', help=' display debug messages')
    parser.add_argument('loweringID', help='lowering ID')
    parser.add_argument('suliusCamCopyScript', help=' original suliusCam copy script to modify')

    args = parser.parse_args()

    # Turn on debug mode
    if args.debug:
        logger.info("Setting log level to DEBUG")
        logger.setLevel(logging.DEBUG)
    
        for handler in logger.handlers:
            handler.setLevel(logging.DEBUG)

    if not os.path.isfile(args.suliusCamCopyScript):
        logger.error(args.suliusCamCopyScript + " does not exist.")
        sys.exit(0)

    new_copyScript = modifyCopyScript(args.loweringID, args.suliusCamCopyScript)

    if(new_copyScript):
        print("#!/bin/bash")
        print("SOURCE_DIR=../SuliusCam")
        print("DEST_DIR=/home/sealog/sealog-files-jason/images")
        print('mkdir -p ${DEST_DIR}/' + args.loweringID + '/' + 'SuliusCam')
        print(new_copyScript)
    else:
        logger.warn("Nothing to return")
