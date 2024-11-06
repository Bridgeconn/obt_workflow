"use client";
import React from "react";
import {
  Box,
  Typography,
  RadioGroup,
  FormControlLabel,
  FormControl,
  Radio,
} from "@mui/material";

const BooksList = ({ files, selectedBook, handleBookSelection, projectName }) => {
  return (
    <Box sx={{ width: "100%" }}>
      <Typography variant="h5" gutterBottom>
        Project Name: {projectName}
      </Typography>

      <Typography variant="h6" gutterBottom>
        Audios Found
      </Typography>

      <FormControl component="fieldset">
        <RadioGroup value={selectedBook} onChange={handleBookSelection}>
          {files.map((file, index) => (
            <Box key={index} sx={{ marginBottom: 2 }}>
              <FormControlLabel
                value={file.bookName}
                control={<Radio />}
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Typography variant="body1" fontWeight="bold">
                      {file.bookName}
                    </Typography>

                    {/* Display chapters inline */}
                    <Box sx={{ display: "flex", gap: 1 }}>
                      {file.chapters.map((chapter, chapterIndex) => (
                        <Box
                          key={chapterIndex}
                          sx={{
                            padding: "4px 8px",
                            border: "1px solid #ccc",
                            borderRadius: "4px",
                            backgroundColor: "#f0f0f0",
                          }}
                        >
                          <Typography variant="body2">
                            {chapter.chapterNumber}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                }
              />
            </Box>
          ))}
        </RadioGroup>
      </FormControl>
    </Box>
  );
};

export default BooksList;
