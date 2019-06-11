#!/bin/bash
#
# Purpose: This script is used to import the modded lowering into Sealog
#
#   Usage: import_lowering_into_sealog.sh
#
#  Author: Webb Pinner webbpinner@gmail.com
# Created: 2019-05-22
#Modified: 2019-05-22

# Parent Directory of sealog database backups
NEW_CRUISE_DIR="/home/sealog/Cruises"

vehicles="Alvin Jason"

# Directory where the script is being run from
_D="$(pwd)"

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

if [ ! -d ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport ]; then
  echo "ERROR: The directory containing the modified files needed to import the lowering: ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING} does not exist."
  echo "You need to run the modify_lowering_for_import.sh script to create this directory and the required import files."
  exit 1
fi


# Stress the potential dangers of continues and confirm the selection
echo "You chose to import ${VEHICLE} lowering ${LOWERING} from cruise: ${CRUISE}."
read -p "Do you want to proceed with the import (y/n)? " -n 1 -r
if ! [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  exit 0
fi

echo ""
echo ""
database=""

if [[ ${VEHICLE} == "Jason" ]]; then
	database="sealogDB_jason"
fi

if [[ ${VEHICLE} == "Alvin" ]]; then
	database="sealogDB_alvin"
fi

lowering_filename="${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/${LOWERING}_loweringRecord_mod.json"
#echo ${lowering_filename}
echo "Importing lowering record..."
mongoimport --db ${database} --collection lowerings --file ${lowering_filename} --jsonArray --mode upsert
echo ""

echo "Importing lowering events"
event_filename="${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/${LOWERING}_eventOnlyExport_mod.json"
#echo ${event_filename}
mongoimport --db ${database} --collection events --file ${event_filename} --jsonArray --mode upsert
echo ""

echo "Importing lowering aux data"
auxdata_filename="${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/${LOWERING}_auxDataExport_mod.json"
#echo ${auxdata_filename}
mongoimport --db ${database} --collection event_aux_data --file ${auxdata_filename} --jsonArray --mode upsert
echo ""

cd ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport

chmod +x ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/framegrabCopyScript_mod.sh
echo "Copying framegrabs"
pv -p -w 80 ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/framegrabCopyScript_mod.sh | bash > /dev/null
echo ""

if [[ ${VEHICLE} == "Jason" && -f ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/suliusCamCopyScript_mod.sh ]]; then
  echo "Copying SuliusCam Stills"
  chmod +x ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/suliusCamCopyScript_mod.sh
  pv -p -w 80 ${NEW_CRUISE_DIR}/${CRUISE}/${LOWERING}/modifiedForImport/suliusCamCopyScript_mod.sh | bash > /dev/null
  echo ""
fi

cd "${_D}"
