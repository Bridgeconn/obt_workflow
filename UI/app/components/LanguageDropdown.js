"use client";
import React, { useState, useEffect } from "react";
// import api from "../store/apiConfig"
import Select from "react-select";
import { CircularProgress, Box } from "@mui/material";

const LanguageDropdown = ({ languages, type, onLanguageChange }) => {
  const [selectedLanguage, setSelectedLanguage] = useState(null);
  const [loadingLanguages, setLoadingLanguages] = useState(false);
  // const [languages, setLanguages] = useState([]);

  // useEffect(() => {
  //   fetchData();
  // }, []);

  // const fetchData = async () => {
  //   try {
  //     setLoadingLanguages(true);
  //    const response = await api.get("/ai/model", {
  //     params: {
  //       model_name: "mms-1b-all",
  //       skip: 0,
  //       limit: 1,
  //     },
  //   });

  //     if (Array.isArray(response.data) && response.data.length > 0) {
  //       setLanguages(response.data[0].languages);
  //     } else {
  //       setLanguages([]);
  //     }
  //   } catch (error) {
  //     console.error("Error fetching data:", error);
  //     setLanguages([]);
  //   } finally {
  //     setLoadingLanguages(false);
  //   }
  // };

  const handleLanguageChange = (selectedOption) => {
    setSelectedLanguage(selectedOption);
    onLanguageChange(type, selectedOption.value);
  };

  const options = languages.map((language) => ({
    value: language?.source_language || language?.major_language,
    label: language.language_name,
  }));

  return (
    <Box sx={{ width: "210px", position: "relative" }}>
      <Select
        options={options}
        value={selectedLanguage}
        onChange={handleLanguageChange}
        placeholder={
          loadingLanguages ? (
            <span style={{ display: "flex", alignItems: "center", fontSize: "18px" }}>
              <CircularProgress size={18} sx={{ marginRight: '8px' }} /> 
              Loading ...
            </span>
          ) : (
            <span style={{ fontSize: "18px" }}>Select Language</span>
          )
        }
        isDisabled={!languages.length}
        styles={{
          container: (base) => ({
            ...base,
            padding: "5px",
            borderRadius: "5px",
          }),
          control: (base) => ({
            ...base,
            backgroundColor: "#333",
            border: 'none',
            borderRadius: "5px",
            boxShadow: 'none',
            '&:hover': {
              borderColor: 'transparent',
            },
          }),
          singleValue: (base) => ({
            ...base,
            color: "white",
            fontSize: "18px",
          }),
          placeholder: (base) => ({
            ...base,
            color: "white",
            fontSize: "18px",
          }),
          input: (base) => ({
            ...base,
            color: "white",
            fontSize: "18px",
          }),
          option: (base, { isFocused }) => ({
            ...base,
            backgroundColor: isFocused ? "#444" : "#333",
            color: "white",
            fontSize: "18px",
            '&:hover': {
              backgroundColor: "#444",
            },
          }),
        }}
      />
    </Box>
  );
};

export default LanguageDropdown;