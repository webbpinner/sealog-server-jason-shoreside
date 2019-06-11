#!/bin/bash
#
# Purpose: This script is modifies the lowering files exported by the at-sea
#          instance of Sealog so that the lowering can be directly ingested
#          by the Shoreside instance of Sealog.
#
#   Usage: modify_lowering_for_import.sh
#
#  Author: Webb Pinner webbpinner@gmail.com
# Created: 2019-05-11
#Modified: 2019-05-22


# Directory containing the sealog data to be modified.
NEW_CRUISE_DIR="/home/sealog/Cruises"

# Possible vehicle choices
vehicles="Alvin Jason"

# Directory where the script is being run from
_D="$(pwd)"

# Parent directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Prompt the user to select a backup to use for the restore
echo "Which vehicle (pick a number):"
PS3="> "
select opt in ${vehicles} "Cancel"; do
    [[ -n $opt ]] && break || {
        echo "Please pick a valid option"
    }
done

if [ $opt == "Cancel" ];then
  exit 0
fi

VEHICLE=$opt
echo ""

cd ${NEW_CRUISE_DIR}
cruise_dirs=`ls ${NEW_CRUISE_DIR}`
cd "${_D}"

echo "Which cruise (pick a number):"
select opt in ${cruise_dirs} "Cancel"; do
    [[ -n $opt ]] && break || {
        echo "Which cruise?"
    }
done

if [ $opt == "Cancel" ];then
  exit 0
fi

CRUISE=$opt
echo ""

cd ${NEW_CRUISE_DIR}/${CRUISE}
lowering_dirs=""

if [[ ${VEHICLE} == "Jason" ]]; then
  lowering_dirs=`ls -d J2-*`
else
  lowering_dirs=`ls -d AL*`
fi
cd "${_D}"

echo "Which lowering (pick a number):"
select opt in ${lowering_dirs} "Cancel"; do
    [[ -n $opt ]] && break || {
        echo "Which lowering?"
    }
done

if [ $opt == "Cancel" ];then
  exit 0
fi

LOWERING=$opt
echo ""

if [ ! -d ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING} ]; then
  echo "ERROR: The lowering directory: ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING} does not exist."
  exit 1
fi


# Stress the potential dangers of continues and confirm the selection
echo "You chose to modify ${VEHICLE} lowering ${LOWERING} within cruise: ${CRUISE}."
echo "Proceeding with this will create the following subdirectory:"
echo ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport
echo "This subdirectory will contain the modified files."
read -p "Please confirm this selection (y/n)?" -n 1 -r
if ! [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  exit 0
fi

echo ""

mkdir -p ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport

echo "Processing Lowering Record..."
python3 ${SCRIPT_DIR}/convert_lowering_records.py ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/${LOWERING}_loweringRecord.json --vehicle ${VEHICLE} > ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/${LOWERING}_loweringRecord_mod.json
if [ $? -ne 0 ]; then
    exit 1
fi

echo "Processing Event Records..."
python3 ${SCRIPT_DIR}/convert_event_records.py ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/${LOWERING}_eventOnlyExport.json --vehicle ${VEHICLE} > ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/${LOWERING}_eventOnlyExport_mod.json
if [ $? -ne 0 ]; then
    exit 1
fi

echo "Processing Aux Data Records..."
python3 ${SCRIPT_DIR}/convert_aux_data_records.py ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/${LOWERING}_auxDataExport.json --vehicle ${VEHICLE} > ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/${LOWERING}_auxDataExport_mod.json
if [ $? -ne 0 ]; then
    exit 1
fi

echo "Processing Framegrab copy script..."
python3 ${SCRIPT_DIR}/convert_framegrab_copy_script.py ${LOWERING} ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/framegrabCopyScript.sh --vehicle ${VEHICLE} > ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/framegrabCopyScript_mod.sh
if [ $? -ne 0 ]; then
    exit 1
fi


if [ ${VEHICLE} == "Jason" ]; then
    if [ -f ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/suliusCamCopyScript.sh ]; then
        echo "Processing SuliusCam copy script..."
        python3 ${SCRIPT_DIR}/convert_suliusCam_copy_script.py ${LOWERING} ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/suliusCamCopyScript.sh > ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/suliusCamCopyScript_mod.sh 
    fi
fi
